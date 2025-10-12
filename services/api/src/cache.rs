use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

use redis::{RedisError, aio::ConnectionManager};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Error as SerdeError;
use thiserror::Error;
use tracing::warn;

use crate::{
    capabilities::{CapabilityCacheKey, ToolCostResponse, ToolSchemaResponse},
    metrics::CacheKind,
};

const CACHE_NAMESPACE: &str = "tyrum:api";

/// Result of consulting the cache for a specific entry.
#[derive(Debug)]
pub enum CacheLookup<T> {
    Hit(T),
    Miss,
    Unavailable,
}

#[derive(Clone)]
pub struct CapabilityCache {
    backend: Option<Arc<RedisBackend>>,
    disabled_warned: Arc<AtomicBool>,
    disabled_reason: Arc<Option<String>>,
}

impl CapabilityCache {
    pub async fn connect(redis_url: Option<String>, ttl: Duration) -> Self {
        match redis_url {
            Some(url) => match RedisBackend::connect(&url, ttl).await {
                Ok(backend) => Self {
                    backend: Some(Arc::new(backend)),
                    disabled_warned: Arc::new(AtomicBool::new(false)),
                    disabled_reason: Arc::new(None),
                },
                Err(error) => {
                    warn!(
                        target = "tyrum_api::cache",
                        reason = %error,
                        "cache_unavailable: failed to initialize redis backend"
                    );
                    Self {
                        backend: None,
                        disabled_warned: Arc::new(AtomicBool::new(false)),
                        disabled_reason: Arc::new(Some(error.to_string())),
                    }
                }
            },
            None => Self {
                backend: None,
                disabled_warned: Arc::new(AtomicBool::new(false)),
                disabled_reason: Arc::new(Some("REDIS_URL not configured".into())),
            },
        }
    }

    pub fn disabled() -> Self {
        Self {
            backend: None,
            disabled_warned: Arc::new(AtomicBool::new(false)),
            disabled_reason: Arc::new(Some("cache explicitly disabled".into())),
        }
    }

    pub async fn schema_lookup(&self, key: &CapabilityCacheKey) -> CacheLookup<ToolSchemaResponse> {
        self.lookup(key, CacheKind::Schema).await
    }

    pub async fn cost_lookup(&self, key: &CapabilityCacheKey) -> CacheLookup<ToolCostResponse> {
        self.lookup(key, CacheKind::Cost).await
    }

    pub async fn cache_schema(&self, key: &CapabilityCacheKey, value: &ToolSchemaResponse) {
        self.store(key, CacheKind::Schema, value).await;
    }

    pub async fn cache_cost(&self, key: &CapabilityCacheKey, value: &ToolCostResponse) {
        self.store(key, CacheKind::Cost, value).await;
    }

    async fn lookup<T>(&self, key: &CapabilityCacheKey, kind: CacheKind) -> CacheLookup<T>
    where
        T: DeserializeOwned,
    {
        if let Some(backend) = &self.backend {
            match backend.get::<T>(key, kind).await {
                Ok(Some(value)) => CacheLookup::Hit(value),
                Ok(None) => CacheLookup::Miss,
                Err(error) => {
                    backend.warn_unavailable(&error);
                    CacheLookup::Unavailable
                }
            }
        } else {
            self.warn_disabled();
            CacheLookup::Unavailable
        }
    }

    async fn store<T>(&self, key: &CapabilityCacheKey, kind: CacheKind, value: &T)
    where
        T: Serialize,
    {
        if let Some(backend) = &self.backend {
            if let Err(error) = backend.set(key, kind, value).await {
                backend.warn_unavailable(&error);
            }
        } else {
            self.warn_disabled();
        }
    }

    fn warn_disabled(&self) {
        if !self.mark_disabled_warned() {
            return;
        }

        Self::emit_disabled_warning(self.disabled_reason());
    }

    fn mark_disabled_warned(&self) -> bool {
        self.disabled_warned
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    fn disabled_reason(&self) -> Option<&str> {
        self.disabled_reason.as_ref().as_deref()
    }

    fn emit_disabled_warning(reason: Option<&str>) {
        match reason {
            Some(reason) => Self::emit_disabled_warning_with_reason(reason),
            None => Self::emit_disabled_warning_without_reason(),
        }
    }

    fn emit_disabled_warning_with_reason(reason: &str) {
        warn!(
            target = "tyrum_api::cache",
            reason = %reason,
            "cache_unavailable: redis cache disabled"
        );
    }

    fn emit_disabled_warning_without_reason() {
        warn!(
            target = "tyrum_api::cache",
            "cache_unavailable: redis cache disabled"
        );
    }
}

#[derive(Debug, Error)]
pub enum CacheBackendError {
    #[error("redis error: {0}")]
    Redis(#[from] RedisError),
    #[error("serialization error: {0}")]
    Serialization(#[from] SerdeError),
}

struct RedisBackend {
    manager: ConnectionManager,
    ttl: Duration,
}

impl RedisBackend {
    async fn connect(url: &str, ttl: Duration) -> Result<Self, CacheBackendError> {
        let client = redis::Client::open(url)?;
        let manager = ConnectionManager::new(client).await?;
        Ok(Self { manager, ttl })
    }

    async fn get<T>(
        &self,
        key: &CapabilityCacheKey,
        kind: CacheKind,
    ) -> Result<Option<T>, CacheBackendError>
    where
        T: DeserializeOwned,
    {
        let mut connection = self.manager.clone();
        let redis_key = key.redis_key(CACHE_NAMESPACE, kind);
        let payload: Option<String> = redis::cmd("GET")
            .arg(redis_key)
            .query_async(&mut connection)
            .await?;

        match payload {
            Some(serialized) => {
                let value = serde_json::from_str(&serialized)?;
                Ok(Some(value))
            }
            None => Ok(None),
        }
    }

    async fn set<T>(
        &self,
        key: &CapabilityCacheKey,
        kind: CacheKind,
        value: &T,
    ) -> Result<(), CacheBackendError>
    where
        T: Serialize,
    {
        let mut connection = self.manager.clone();
        let redis_key = key.redis_key(CACHE_NAMESPACE, kind);
        let serialized = serde_json::to_string(value)?;
        let ttl_seconds = self.ttl.as_secs();

        if ttl_seconds == 0 {
            let _: () = redis::cmd("SET")
                .arg(redis_key)
                .arg(serialized)
                .query_async(&mut connection)
                .await?;
        } else {
            let _: () = redis::cmd("SETEX")
                .arg(redis_key)
                .arg(ttl_seconds as usize)
                .arg(serialized)
                .query_async(&mut connection)
                .await?;
        }

        Ok(())
    }

    fn warn_unavailable(&self, error: &CacheBackendError) {
        warn!(
            target = "tyrum_api::cache",
            reason = %error,
            "cache_unavailable: redis operation failed"
        );
    }
}
