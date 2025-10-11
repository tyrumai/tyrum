use std::fmt;
use std::time::Duration;

#[cfg(any(test, feature = "test-support"))]
use std::collections::HashMap;
#[cfg(any(test, feature = "test-support"))]
use std::sync::RwLock;

use redis::Commands;
use serde::{Deserialize, Serialize};

use crate::pipeline::DiscoveryStrategy;

#[derive(Debug)]
pub enum CacheError {
    Redis(redis::RedisError),
    Encoding(serde_json::Error),
}

impl From<redis::RedisError> for CacheError {
    fn from(error: redis::RedisError) -> Self {
        Self::Redis(error)
    }
}

impl From<serde_json::Error> for CacheError {
    fn from(error: serde_json::Error) -> Self {
        Self::Encoding(error)
    }
}

impl fmt::Display for CacheError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Redis(error) => write!(f, "redis error: {error}"),
            Self::Encoding(error) => write!(f, "encoding error: {error}"),
        }
    }
}

impl std::error::Error for CacheError {}

pub trait ConnectorCache: Send + Sync {
    fn fetch(&self, key: &str) -> Result<Option<Vec<CachedConnector>>, CacheError>;

    fn store(&self, key: &str, connectors: &[CachedConnector]) -> Result<(), CacheError>;
}

#[derive(Debug)]
pub struct RedisConnectorCache {
    client: redis::Client,
    ttl: Duration,
}

impl RedisConnectorCache {
    /// # Errors
    ///
    /// Returns [`CacheError`] when the Redis client cannot be created from the provided URL.
    pub fn new(redis_url: &str, ttl: Duration) -> Result<Self, CacheError> {
        let client = redis::Client::open(redis_url)?;
        Ok(Self { client, ttl })
    }
}

impl ConnectorCache for RedisConnectorCache {
    fn fetch(&self, key: &str) -> Result<Option<Vec<CachedConnector>>, CacheError> {
        let mut connection = self.client.get_connection()?;
        let result: Option<String> = connection.get(key)?;
        match result {
            Some(payload) => {
                let envelope: CacheEnvelope = serde_json::from_str(&payload)?;
                Ok(Some(envelope.connectors))
            }
            None => Ok(None),
        }
    }

    fn store(&self, key: &str, connectors: &[CachedConnector]) -> Result<(), CacheError> {
        let mut connection = self.client.get_connection()?;
        let payload = CacheEnvelope {
            connectors: connectors.to_vec(),
        };
        let serialized = serde_json::to_string(&payload)?;

        let ttl_secs = self.ttl.as_secs();
        if ttl_secs == 0 {
            let _: () = connection.set(key, serialized)?;
        } else {
            let _: () = connection.set_ex(key, serialized, ttl_secs)?;
        }

        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CachedConnector {
    pub strategy: DiscoveryStrategy,
    pub locator: String,
    pub success_count: u32,
    pub last_seen_epoch_ms: u64,
}

impl CachedConnector {
    pub fn bump(&mut self, now_epoch_ms: u64) {
        self.last_seen_epoch_ms = now_epoch_ms;
        self.success_count = self.success_count.saturating_add(1);
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct CacheEnvelope {
    connectors: Vec<CachedConnector>,
}

#[cfg(any(test, feature = "test-support"))]
#[allow(dead_code)]
pub struct InMemoryConnectorCache {
    store: RwLock<HashMap<String, Vec<CachedConnector>>>,
}

#[cfg(any(test, feature = "test-support"))]
#[allow(dead_code)]
impl InMemoryConnectorCache {
    #[must_use]
    pub fn new() -> Self {
        Self {
            store: RwLock::new(HashMap::new()),
        }
    }

    pub fn seed(&self, key: &str, connectors: Vec<CachedConnector>) {
        let mut guard = match self.store.write() {
            Ok(guard) => guard,
            Err(poisoned) => {
                eprintln!("in-memory connector cache write lock poisoned");
                poisoned.into_inner()
            }
        };
        guard.insert(key.to_string(), connectors);
    }
}

#[cfg(any(test, feature = "test-support"))]
impl ConnectorCache for InMemoryConnectorCache {
    fn fetch(&self, key: &str) -> Result<Option<Vec<CachedConnector>>, CacheError> {
        let guard = match self.store.read() {
            Ok(guard) => guard,
            Err(poisoned) => {
                eprintln!("in-memory connector cache read lock poisoned");
                poisoned.into_inner()
            }
        };
        Ok(guard.get(key).cloned())
    }

    fn store(&self, key: &str, connectors: &[CachedConnector]) -> Result<(), CacheError> {
        let mut guard = match self.store.write() {
            Ok(guard) => guard,
            Err(poisoned) => {
                eprintln!("in-memory connector cache write lock poisoned");
                poisoned.into_inner()
            }
        };
        guard.insert(key.to_string(), connectors.to_vec());
        Ok(())
    }
}

#[cfg(any(test, feature = "test-support"))]
impl Default for InMemoryConnectorCache {
    fn default() -> Self {
        Self::new()
    }
}
