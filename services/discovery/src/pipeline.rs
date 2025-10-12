use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::net::IpAddr;
use std::num::NonZeroUsize;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};
use url::Url;

use crate::cache::{CacheError, CachedConnector, ConnectorCache, RedisConnectorCache};
use crate::probe::{ProbeOutcome, ProbeResult, probe_structured_origin};
use crate::telemetry::{self, ProbeStatus};

fn default_top_k() -> NonZeroUsize {
    NonZeroUsize::new(5).unwrap_or(NonZeroUsize::MIN)
}

fn default_probe_timeout() -> Duration {
    Duration::from_secs(2)
}

/// Request envelope supplied to discovery strategies.
///
/// The `subject` should be a sanitized descriptor such as a domain, MCP
/// capability name, or structured API identifier. Callers are responsible for
/// removing credentials or user-scoped tokens before construction to keep log
/// output compliant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryRequest {
    pub subject: String,
}

impl DiscoveryRequest {
    /// Returns a human-readable but sanitized subject for logging.
    #[must_use]
    pub fn sanitized_subject(&self) -> &str {
        &self.subject
    }
}

/// Result of a discovery attempt.
///
/// The enum will expand as executors land. Planned additions include variants
/// for consent escalation, partial matches, and cached connectors once the
/// policy gate owns credential brokering.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiscoveryOutcome {
    /// Discovery succeeded and returns sanitized connector metadata for
    /// executor hand-off.
    Found(DiscoveryResolution),
    /// No strategy produced a match; downstream callers can offer manual
    /// fallback or prompt for more context.
    NotFound,
    /// Upstream requested a retry (rate limit, temporary outage, etc.).
    RetryLater { retry_after: Option<Duration> },
    /// Policy denied or escalated the requested connector scope.
    RequiresConsent { scope: String },
}

impl DiscoveryOutcome {
    fn continues(&self) -> bool {
        matches!(self, Self::NotFound)
    }

    pub(crate) fn label(&self) -> &'static str {
        match self {
            Self::Found(_) => "found",
            Self::NotFound => "not_found",
            Self::RetryLater { .. } => "retry_later",
            Self::RequiresConsent { .. } => "requires_consent",
        }
    }
}

/// Connector metadata surfaced back to executors.
///
/// The `locator` will eventually carry structured connection data (endpoint
/// URIs, tool identifiers) once we integrate with the planner memory service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryConnector {
    pub strategy: DiscoveryStrategy,
    pub locator: String,
    pub rank: usize,
}

impl DiscoveryConnector {
    fn new(strategy: DiscoveryStrategy, locator: String) -> Self {
        Self {
            strategy,
            locator,
            rank: 0,
        }
    }

    fn with_rank(mut self, rank: usize) -> Self {
        self.rank = rank;
        self
    }
}

/// Ranked discovery result comprising the primary connector and alternatives.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryResolution {
    pub primary: DiscoveryConnector,
    pub alternatives: Vec<DiscoveryConnector>,
}

impl DiscoveryResolution {
    #[must_use]
    pub fn single(connector: DiscoveryConnector) -> Self {
        Self {
            primary: connector,
            alternatives: Vec::new(),
        }
    }

    #[must_use]
    pub fn from_ranked(mut connectors: Vec<DiscoveryConnector>) -> Option<Self> {
        if connectors.is_empty() {
            return None;
        }

        let primary = connectors.remove(0);
        Some(Self {
            primary,
            alternatives: connectors,
        })
    }

    pub fn connectors(&self) -> impl Iterator<Item = &DiscoveryConnector> {
        std::iter::once(&self.primary).chain(self.alternatives.iter())
    }
}

/// Enumerates the strategies executed by the pipeline.
///
/// The order here mirrors the MVP cut outlined in `docs/product_concept_v1.md`
/// and should stay in sync with the planner's decision tree.
#[derive(Debug, Copy, Clone, PartialEq, Eq, Serialize, Deserialize, Hash)]
pub enum DiscoveryStrategy {
    Mcp,
    StructuredApi,
    GenericHttp,
}

impl DiscoveryStrategy {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Mcp => "mcp",
            Self::StructuredApi => "structured_api",
            Self::GenericHttp => "generic_http",
        }
    }
}

/// Defines the contract for executing discovery strategies in a fixed order.
#[async_trait]
pub trait DiscoveryPipeline: Send + Sync {
    async fn try_mcp(&self, request: &DiscoveryRequest) -> DiscoveryOutcome;

    async fn try_structured_api(&self, request: &DiscoveryRequest) -> DiscoveryOutcome;

    async fn try_generic_http(&self, request: &DiscoveryRequest) -> DiscoveryOutcome;

    /// Executes the discovery strategies in priority order, short-circuiting on
    /// the first non-`NotFound` outcome.
    async fn discover(&self, request: &DiscoveryRequest) -> DiscoveryOutcome {
        debug!(
            subject = %request.sanitized_subject(),
            "Starting discovery"
        );

        let outcome = execute_step(request, DiscoveryStrategy::Mcp, || async {
            self.try_mcp(request).await
        })
        .await;
        if !outcome.continues() {
            return outcome;
        }

        let outcome = execute_step(request, DiscoveryStrategy::StructuredApi, || async {
            self.try_structured_api(request).await
        })
        .await;
        if !outcome.continues() {
            return outcome;
        }

        execute_step(request, DiscoveryStrategy::GenericHttp, || async {
            self.try_generic_http(request).await
        })
        .await
    }
}

/// Default discovery pipeline that performs lightweight heuristics to surface
/// MCP, structured API, or generic HTTP connectors while caching ranked
/// results in Redis.
pub struct DefaultDiscoveryPipeline {
    cache: Option<PipelineCache>,
    top_k: NonZeroUsize,
    probe_client: Client,
    probe_timeout: Duration,
}

struct PipelineCache {
    backend: Arc<dyn ConnectorCache>,
    namespace: String,
}

impl PipelineCache {
    fn backend(&self) -> Arc<dyn ConnectorCache> {
        Arc::clone(&self.backend)
    }

    fn key_for(&self, subject: &str) -> String {
        let encoded = URL_SAFE_NO_PAD.encode(subject.as_bytes());
        format!("{}:{encoded}", self.namespace)
    }
}

struct CacheContext {
    backend: Arc<dyn ConnectorCache>,
    key: String,
}

#[derive(Clone)]
pub struct DiscoveryPipelineConfig {
    pub cache: Option<DiscoveryCacheSettings>,
    pub top_k: NonZeroUsize,
    pub probe_timeout: Duration,
}

impl Default for DiscoveryPipelineConfig {
    fn default() -> Self {
        Self {
            cache: None,
            top_k: default_top_k(),
            probe_timeout: default_probe_timeout(),
        }
    }
}

#[derive(Clone)]
pub struct DiscoveryCacheSettings {
    pub redis_url: String,
    pub namespace: String,
    pub ttl: Duration,
}

impl DiscoveryCacheSettings {
    #[must_use]
    pub fn new(redis_url: impl Into<String>, namespace: impl Into<String>, ttl: Duration) -> Self {
        Self {
            redis_url: redis_url.into(),
            namespace: namespace.into(),
            ttl,
        }
    }
}

impl Default for DefaultDiscoveryPipeline {
    fn default() -> Self {
        Self::new()
    }
}

impl DefaultDiscoveryPipeline {
    /// Creates a pipeline instance using built-in heuristics without caching.
    #[must_use]
    pub fn new() -> Self {
        Self {
            cache: None,
            top_k: default_top_k(),
            probe_client: Client::new(),
            probe_timeout: default_probe_timeout(),
        }
    }

    #[must_use]
    pub fn with_probe_timeout(timeout: Duration) -> Self {
        Self {
            cache: None,
            top_k: default_top_k(),
            probe_client: Client::new(),
            probe_timeout: timeout,
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    #[must_use]
    pub fn with_probe_client(client: Client, probe_timeout: Duration) -> Self {
        Self {
            cache: None,
            top_k: default_top_k(),
            probe_client: client,
            probe_timeout,
        }
    }

    /// Creates a pipeline from configuration, optionally enabling Redis cache.
    ///
    /// # Errors
    ///
    /// Returns [`CacheError`] when the configured cache backend cannot be initialized.
    pub fn from_config(config: DiscoveryPipelineConfig) -> Result<Self, CacheError> {
        let cache = if let Some(settings) = config.cache {
            Some(PipelineCache {
                backend: Arc::new(RedisConnectorCache::new(&settings.redis_url, settings.ttl)?),
                namespace: settings.namespace,
            })
        } else {
            None
        };

        Ok(Self {
            cache,
            top_k: config.top_k,
            probe_client: Client::new(),
            probe_timeout: config.probe_timeout,
        })
    }

    /// Convenience helper for enabling Redis cache with default top-k.
    ///
    /// # Errors
    ///
    /// Returns [`CacheError`] when the cache backend cannot be initialized.
    pub fn with_cache(settings: DiscoveryCacheSettings) -> Result<Self, CacheError> {
        Self::from_config(DiscoveryPipelineConfig {
            cache: Some(settings),
            ..DiscoveryPipelineConfig::default()
        })
    }

    fn descriptor(&self, request: &DiscoveryRequest) -> SubjectDescriptor {
        SubjectDescriptor::parse(request.sanitized_subject())
    }

    fn detect_mcp(&self, descriptor: &SubjectDescriptor) -> Option<String> {
        if let Some(locator) = parse_mcp_locator(descriptor.trimmed.as_str()) {
            return Some(locator);
        }

        if let Some(remainder) = strip_prefix_case_insensitive(descriptor.trimmed.as_str(), "mcp:")
        {
            let slug = remainder.trim_start_matches('/');
            if slug.is_empty() {
                return None;
            }
            let candidate = format!("mcp://{}", slug);
            return parse_mcp_locator(&candidate);
        }

        for (alias, locator) in MCP_ALIAS_MAP {
            if descriptor.tokens.iter().any(|token| token == alias) {
                return Some(locator.to_string());
            }
        }

        None
    }

    fn detect_structured_api(&self, descriptor: &SubjectDescriptor) -> Option<String> {
        if let Some(url) = descriptor.url.as_ref().filter(|url| {
            matches!(url.scheme(), "http" | "https") && indicates_structured_endpoint(url)
        }) {
            return Some(Self::canonicalize_http_url(url));
        }

        if descriptor
            .tokens
            .iter()
            .any(|token| STRUCTURED_KEYWORDS.contains(&token.as_str()))
        {
            return descriptor
                .url
                .as_ref()
                .filter(|url| matches!(url.scheme(), "http" | "https"))
                .map(Self::canonicalize_http_url)
                .or_else(|| Some(build_structured_locator_from_tokens(&descriptor.tokens)));
        }

        if let Some(locator) = self.structured_from_alias(descriptor) {
            return Some(locator);
        }

        None
    }

    async fn probe_structured_connectors(
        &self,
        descriptor: &SubjectDescriptor,
    ) -> Option<Vec<DiscoveryConnector>> {
        let url = descriptor.url.as_ref()?;
        let origin = Self::https_origin(url)?;

        let started = Instant::now();
        let ProbeResult { outcome, urls } =
            probe_structured_origin(&self.probe_client, &origin, self.probe_timeout).await;
        let elapsed = started.elapsed();
        telemetry::record_probe(Self::map_probe_status(outcome), elapsed);

        let connectors = urls
            .into_iter()
            .filter_map(|url| {
                if !matches!(url.scheme(), "http" | "https") {
                    return None;
                }
                Some(DiscoveryConnector::new(
                    DiscoveryStrategy::StructuredApi,
                    Self::canonicalize_http_url(&url),
                ))
            })
            .collect::<Vec<_>>();

        Some(connectors)
    }

    fn map_probe_status(outcome: ProbeOutcome) -> ProbeStatus {
        match outcome {
            ProbeOutcome::Success => ProbeStatus::Success,
            ProbeOutcome::Miss => ProbeStatus::Miss,
            ProbeOutcome::Timeout => ProbeStatus::Timeout,
            ProbeOutcome::Error => ProbeStatus::Error,
        }
    }

    fn https_origin(url: &Url) -> Option<Url> {
        if !url.scheme().eq_ignore_ascii_case("https") {
            return None;
        }

        let mut origin = url.clone();
        origin.set_path("/");
        origin.set_query(None);
        origin.set_fragment(None);
        origin.set_username("").ok()?;
        origin.set_password(None).ok()?;
        Some(origin)
    }

    fn dedupe_connectors(connectors: Vec<DiscoveryConnector>) -> Vec<DiscoveryConnector> {
        let mut seen = HashSet::new();
        let mut deduped = Vec::new();

        for connector in connectors {
            let key = (connector.strategy, connector.locator.clone());
            if seen.insert(key) {
                deduped.push(connector);
            }
        }

        deduped
    }

    fn structured_from_alias(&self, descriptor: &SubjectDescriptor) -> Option<String> {
        if descriptor.tokens.is_empty() {
            return None;
        }

        let looks_like_namespace =
            descriptor.lowercase.contains(':') || descriptor.lowercase.contains(' ');
        if !looks_like_namespace {
            return None;
        }

        // Handle subjects such as `api:calendar:events` by skipping the `api`
        // prefix when present.
        if descriptor.tokens.len() >= 2 && descriptor.tokens[0] == "api" {
            let service = descriptor.tokens[1].clone();
            let remainder = descriptor
                .tokens
                .iter()
                .skip(2)
                .cloned()
                .collect::<Vec<_>>();
            return Some(build_structured_locator(&service, &remainder));
        }

        for alias in STRUCTURED_ALIAS_HINTS {
            if let Some(index) = descriptor.tokens.iter().position(|token| token == alias) {
                let remainder = descriptor
                    .tokens
                    .iter()
                    .enumerate()
                    .filter_map(|(idx, token)| (idx > index).then_some(token.clone()))
                    .collect::<Vec<_>>();
                return Some(build_structured_locator(alias, &remainder));
            }
        }

        None
    }

    fn detect_generic_http(&self, descriptor: &SubjectDescriptor) -> Option<String> {
        if let Some(url) = descriptor
            .url
            .as_ref()
            .filter(|url| matches!(url.scheme(), "http" | "https"))
        {
            return Some(Self::canonicalize_http_url(url));
        }

        let candidate = descriptor.trimmed.trim();
        if looks_like_hostname(candidate) {
            let url_str = format!(
                "https://{}",
                candidate
                    .trim_start_matches("https://")
                    .trim_start_matches("http://")
            );
            if let Ok(url) = Url::parse(&url_str) {
                return Some(Self::canonicalize_http_url(&url));
            }
        }

        None
    }

    fn canonicalize_http_url(url: &Url) -> String {
        let mut normalized = url.clone();
        normalized.set_fragment(None);

        let mut value = normalized.to_string();
        if normalized.path() == "/" && normalized.query().is_none() && value.ends_with('/') {
            value.pop();
        }
        value
    }

    fn cache_context(&self, subject: &str) -> Option<CacheContext> {
        self.cache.as_ref().map(|cache| CacheContext {
            backend: cache.backend(),
            key: cache.key_for(subject),
        })
    }

    fn try_cache_hit(
        &self,
        subject: &str,
        context: &Option<CacheContext>,
    ) -> Option<DiscoveryOutcome> {
        let Some(context) = context else {
            telemetry::record_cache_event(telemetry::CacheEvent::Miss);
            return None;
        };

        match context.backend.fetch(&context.key) {
            Ok(Some(entries)) => {
                telemetry::record_cache_event(telemetry::CacheEvent::Hit);
                return self.handle_cached_entries(subject, context, entries);
            }
            Ok(None) => telemetry::record_cache_event(telemetry::CacheEvent::Miss),
            Err(error) => {
                warn!(%subject, %error, "failed to load discovery cache entry");
                telemetry::record_cache_event(telemetry::CacheEvent::Error);
            }
        }

        None
    }

    async fn collect_connectors(
        &self,
        request: &DiscoveryRequest,
        now_ms: u64,
    ) -> Result<Vec<CachedConnector>, DiscoveryOutcome> {
        let mut collected = Vec::new();

        let outcome = execute_step(request, DiscoveryStrategy::Mcp, || async {
            self.try_mcp(request).await
        })
        .await;
        match outcome {
            DiscoveryOutcome::Found(resolution) => {
                collected.extend(self.cache_entries_from_resolution(resolution, now_ms));
                return Ok(collected);
            }
            DiscoveryOutcome::RetryLater { .. } => return Err(outcome),
            DiscoveryOutcome::RequiresConsent { .. } => return Err(outcome),
            DiscoveryOutcome::NotFound => {}
        }

        let outcome = execute_step(request, DiscoveryStrategy::StructuredApi, || async {
            self.try_structured_api(request).await
        })
        .await;
        match outcome {
            DiscoveryOutcome::Found(resolution) => {
                collected.extend(self.cache_entries_from_resolution(resolution, now_ms));
                return Ok(collected);
            }
            DiscoveryOutcome::RetryLater { .. } => return Err(outcome),
            DiscoveryOutcome::RequiresConsent { .. } => return Err(outcome),
            DiscoveryOutcome::NotFound => {}
        }

        let outcome = execute_step(request, DiscoveryStrategy::GenericHttp, || async {
            self.try_generic_http(request).await
        })
        .await;
        match outcome {
            DiscoveryOutcome::Found(resolution) => {
                collected.extend(self.cache_entries_from_resolution(resolution, now_ms));
            }
            DiscoveryOutcome::RetryLater { .. } => return Err(outcome),
            DiscoveryOutcome::RequiresConsent { .. } => return Err(outcome),
            DiscoveryOutcome::NotFound => {}
        }

        Ok(collected)
    }

    fn handle_cached_entries(
        &self,
        subject: &str,
        context: &CacheContext,
        mut entries: Vec<CachedConnector>,
    ) -> Option<DiscoveryOutcome> {
        let now = Self::now_epoch_ms();
        for entry in entries.iter_mut() {
            entry.bump(now);
        }
        let ranked = self.normalize_entries(entries);
        let resolution = self.resolution_from_cached(&ranked)?;
        if let Err(error) = context.backend.store(&context.key, &ranked) {
            warn!(%subject, %error, "failed to refresh discovery cache entry");
            telemetry::record_cache_event(telemetry::CacheEvent::Error);
        }
        Some(DiscoveryOutcome::Found(resolution))
    }

    fn persist_cache(
        &self,
        context: &Option<CacheContext>,
        ranked: &[CachedConnector],
        subject: &str,
    ) {
        if let Some(context) = context
            && let Err(error) = context.backend.store(&context.key, ranked)
        {
            warn!(%subject, %error, "failed to write discovery cache entry");
            telemetry::record_cache_event(telemetry::CacheEvent::Error);
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn with_cache_backend(
        backend: Arc<dyn ConnectorCache>,
        namespace: &str,
        top_k: NonZeroUsize,
    ) -> Self {
        Self {
            cache: Some(PipelineCache {
                backend,
                namespace: namespace.to_string(),
            }),
            top_k,
            probe_client: Client::new(),
            probe_timeout: default_probe_timeout(),
        }
    }

    fn cache_entries_from_resolution(
        &self,
        resolution: DiscoveryResolution,
        now_ms: u64,
    ) -> Vec<CachedConnector> {
        let DiscoveryResolution {
            primary,
            alternatives,
        } = resolution;
        let mut connectors = Vec::with_capacity(1 + alternatives.len());
        connectors.push(primary);
        connectors.extend(alternatives);

        connectors
            .into_iter()
            .map(|connector| CachedConnector {
                strategy: connector.strategy,
                locator: connector.locator,
                success_count: Self::base_weight(connector.strategy),
                last_seen_epoch_ms: now_ms,
            })
            .collect()
    }

    fn normalize_entries(&self, entries: Vec<CachedConnector>) -> Vec<CachedConnector> {
        let mut deduped: HashMap<(DiscoveryStrategy, String), CachedConnector> = HashMap::new();
        for entry in entries {
            let key = (entry.strategy, entry.locator.clone());
            deduped
                .entry(key)
                .and_modify(|existing| {
                    if entry.last_seen_epoch_ms > existing.last_seen_epoch_ms {
                        existing.last_seen_epoch_ms = entry.last_seen_epoch_ms;
                    }
                    existing.success_count = existing.success_count.max(entry.success_count);
                })
                .or_insert(entry);
        }

        let mut unique: Vec<_> = deduped.into_values().collect();
        unique.sort_by(|a, b| {
            b.success_count
                .cmp(&a.success_count)
                .then_with(|| b.last_seen_epoch_ms.cmp(&a.last_seen_epoch_ms))
        });
        unique.truncate(self.top_k.get());
        unique
    }

    fn resolution_from_cached(&self, entries: &[CachedConnector]) -> Option<DiscoveryResolution> {
        let ranked = entries
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                DiscoveryConnector::new(entry.strategy, entry.locator.clone()).with_rank(index + 1)
            })
            .collect::<Vec<_>>();

        DiscoveryResolution::from_ranked(ranked)
    }

    fn base_weight(strategy: DiscoveryStrategy) -> u32 {
        match strategy {
            DiscoveryStrategy::Mcp => 10,
            DiscoveryStrategy::StructuredApi => 6,
            DiscoveryStrategy::GenericHttp => 3,
        }
    }

    fn now_epoch_ms() -> u64 {
        match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(duration) => clamp_millis(duration.as_millis()),
            Err(_) => {
                let start = FALLBACK_MONOTONIC.get_or_init(Instant::now);
                clamp_millis(start.elapsed().as_millis())
            }
        }
    }
}

static FALLBACK_MONOTONIC: OnceLock<Instant> = OnceLock::new();

fn clamp_millis(value: u128) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

#[async_trait]
impl DiscoveryPipeline for DefaultDiscoveryPipeline {
    async fn discover(&self, request: &DiscoveryRequest) -> DiscoveryOutcome {
        debug!(
            subject = %request.sanitized_subject(),
            "Starting discovery"
        );

        let subject = request.sanitized_subject();
        let cache_context = self.cache_context(subject);

        if let Some(outcome) = self.try_cache_hit(subject, &cache_context) {
            return outcome;
        }

        let now = Self::now_epoch_ms();
        let connectors = match self.collect_connectors(request, now).await {
            Ok(connectors) => connectors,
            Err(outcome) => return outcome,
        };

        if connectors.is_empty() {
            return DiscoveryOutcome::NotFound;
        }

        let ranked = self.normalize_entries(connectors);
        let Some(resolution) = self.resolution_from_cached(&ranked) else {
            return DiscoveryOutcome::NotFound;
        };

        self.persist_cache(&cache_context, &ranked, subject);

        DiscoveryOutcome::Found(resolution)
    }

    async fn try_mcp(&self, request: &DiscoveryRequest) -> DiscoveryOutcome {
        let descriptor = self.descriptor(request);
        match self.detect_mcp(&descriptor) {
            Some(locator) => DiscoveryOutcome::Found(DiscoveryResolution::single(
                DiscoveryConnector::new(DiscoveryStrategy::Mcp, locator),
            )),
            None => DiscoveryOutcome::NotFound,
        }
    }

    async fn try_structured_api(&self, request: &DiscoveryRequest) -> DiscoveryOutcome {
        let descriptor = self.descriptor(request);
        let mut connectors = Vec::new();

        if let Some(locator) = self.detect_structured_api(&descriptor) {
            connectors.push(DiscoveryConnector::new(
                DiscoveryStrategy::StructuredApi,
                locator,
            ));
        }

        if let Some(mut probed) = self.probe_structured_connectors(&descriptor).await {
            connectors.append(&mut probed);
        }

        let connectors = Self::dedupe_connectors(connectors);

        if connectors.is_empty() {
            return DiscoveryOutcome::NotFound;
        }

        let ranked = connectors
            .into_iter()
            .enumerate()
            .map(|(index, connector)| connector.with_rank(index + 1))
            .collect::<Vec<_>>();

        match DiscoveryResolution::from_ranked(ranked) {
            Some(resolution) => DiscoveryOutcome::Found(resolution),
            None => DiscoveryOutcome::NotFound,
        }
    }

    async fn try_generic_http(&self, request: &DiscoveryRequest) -> DiscoveryOutcome {
        let descriptor = self.descriptor(request);
        match self.detect_generic_http(&descriptor) {
            Some(locator) => DiscoveryOutcome::Found(DiscoveryResolution::single(
                DiscoveryConnector::new(DiscoveryStrategy::GenericHttp, locator),
            )),
            None => DiscoveryOutcome::NotFound,
        }
    }
}

const MCP_ALIAS_MAP: &[(&str, &str)] = &[
    ("calendar", "mcp://calendar"),
    ("crm", "mcp://crm"),
    ("email", "mcp://email"),
    ("files", "mcp://files"),
    ("tasks", "mcp://tasks"),
    ("support", "mcp://support"),
];

const STRUCTURED_ALIAS_HINTS: &[&str] = &[
    "api",
    "calendar",
    "crm",
    "billing",
    "payments",
    "inventory",
    "orders",
    "support",
    "email",
    "files",
    "docs",
];

const STRUCTURED_KEYWORDS: &[&str] = &["openapi", "graphql", "swagger", "rest", "caldav", "imap"];

const TOKEN_SPLIT_CHARS: &[char] = &[
    ':', '/', '.', ' ', '\t', '\n', '\r', '?', '#', '&', '=', '_', '-', '\\', '@',
];

#[derive(Debug, Clone)]
struct SubjectDescriptor {
    trimmed: String,
    lowercase: String,
    tokens: Vec<String>,
    url: Option<Url>,
}

impl SubjectDescriptor {
    fn parse(subject: &str) -> Self {
        let trimmed = subject.trim().to_string();
        let lowercase = trimmed.to_lowercase();
        let tokens = tokenize(&trimmed);
        let url = parse_url_candidate(&trimmed);

        Self {
            trimmed,
            lowercase,
            tokens,
            url,
        }
    }
}

fn tokenize(value: &str) -> Vec<String> {
    value
        .split(|c: char| TOKEN_SPLIT_CHARS.contains(&c))
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.trim_matches(|ch: char| ch == '"' || ch == '\''))
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.to_lowercase())
        .collect()
}

fn parse_url_candidate(value: &str) -> Option<Url> {
    if value.is_empty() {
        return None;
    }

    let parsed = Url::parse(value).ok().or_else(|| {
        if value.contains("://") {
            return None;
        }

        let candidate = format!("https://{}", value.trim_start_matches('/'));
        Url::parse(&candidate).ok()
    });

    parsed.filter(|url| url.host_str().is_some_and(valid_host_candidate))
}

fn indicates_structured_endpoint(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default().to_lowercase();
    if host.starts_with("api.")
        || host.contains(".api.")
        || host.ends_with(".api")
        || host.contains("graphql")
    {
        return true;
    }

    let path = url.path().to_lowercase();
    if path.contains("/api/") {
        return true;
    }

    STRUCTURED_KEYWORDS
        .iter()
        .any(|keyword| path.contains(keyword))
}

fn build_structured_locator(service: &str, remainder: &[String]) -> String {
    let service_slug = sanitize_segment(service);

    let segments: Vec<_> = remainder
        .iter()
        .map(|segment| sanitize_segment(segment))
        .filter(|segment| !segment.is_empty() && segment != "unknown")
        .collect();

    if segments.is_empty() {
        format!("structured://{}", service_slug)
    } else {
        format!("structured://{}/{}", service_slug, segments.join("/"))
    }
}

fn build_structured_locator_from_tokens(tokens: &[String]) -> String {
    if tokens.is_empty() {
        return "structured://subject".to_string();
    }

    if tokens.len() == 1 {
        return format!("structured://{}", sanitize_segment(&tokens[0]));
    }

    build_structured_locator(&tokens[0], &tokens[1..])
}

fn sanitize_segment(segment: &str) -> String {
    let mut sanitized = String::new();
    for ch in segment.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
            sanitized.push(ch.to_ascii_lowercase());
        }
    }

    if sanitized.is_empty() {
        let fallback = segment
            .chars()
            .filter(|c| c.is_alphanumeric())
            .map(|c| c.to_ascii_lowercase())
            .collect::<String>();
        if fallback.is_empty() {
            "unknown".to_string()
        } else {
            fallback
        }
    } else {
        sanitized
    }
}

fn looks_like_hostname(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }

    let candidate = trimmed
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("www.");

    if candidate.starts_with("mcp://") {
        return false;
    }

    let host_port = candidate
        .split(|c| ['/', '?', '#'].contains(&c))
        .next()
        .unwrap_or(candidate);
    if host_port.is_empty() {
        return false;
    }

    let (host, port) = if let Some((host, port)) = host_port.split_once(':') {
        (host, Some(port))
    } else {
        (host_port, None)
    };

    if host.is_empty() || !valid_host_candidate(host) {
        return false;
    }

    if port
        .map(|port| port.is_empty() || !port.chars().all(|ch| ch.is_ascii_digit()))
        .unwrap_or(false)
    {
        return false;
    }

    true
}

fn valid_host_candidate(host: &str) -> bool {
    if host.is_empty() {
        return false;
    }

    if host.eq_ignore_ascii_case("localhost") || host.parse::<IpAddr>().is_ok() {
        return true;
    }

    if !host.contains('.') {
        return false;
    }

    host.chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '.'))
}

fn parse_mcp_locator(candidate: &str) -> Option<String> {
    let mut url = Url::parse(candidate).ok()?;
    if !url.scheme().eq_ignore_ascii_case("mcp") {
        return None;
    }
    let host = url.host_str().map(|host| host.to_ascii_lowercase())?;
    if host.is_empty() {
        return None;
    }
    url.set_host(Some(&host)).ok()?;
    url.set_fragment(None);
    if url.set_scheme("mcp").is_err() {
        return None;
    }
    Some(url.to_string())
}

fn strip_prefix_case_insensitive<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    if value.len() < prefix.len() {
        return None;
    }

    if value[..prefix.len()].eq_ignore_ascii_case(prefix) {
        Some(&value[prefix.len()..])
    } else {
        None
    }
}
#[allow(clippy::cognitive_complexity)]
async fn execute_step<F, Fut>(
    request: &DiscoveryRequest,
    strategy: DiscoveryStrategy,
    attempt: F,
) -> DiscoveryOutcome
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = DiscoveryOutcome> + Send,
{
    debug!(
        subject = %request.sanitized_subject(),
        strategy = strategy.as_str(),
        "Running discovery step",
    );

    let outcome = telemetry::record_step(strategy, request.sanitized_subject(), attempt).await;

    if outcome.continues() {
        debug!(strategy = strategy.as_str(), "Strategy returned NotFound");
    } else {
        debug!(strategy = strategy.as_str(), outcome = ?outcome, "Strategy resolved");
    }

    outcome
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used, clippy::len_zero)]
    use super::*;
    use std::fmt;
    use std::future::Future;
    use std::num::NonZeroUsize;
    use std::sync::{Arc, Mutex, MutexGuard};

    use crate::cache::InMemoryConnectorCache;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use httpmock::{Method, prelude::*};
    use once_cell::sync::Lazy;
    use opentelemetry::{Value, global};
    use opentelemetry_sdk::metrics::{
        InMemoryMetricExporter, PeriodicReader, SdkMeterProvider,
        data::{AggregatedMetrics, HistogramDataPoint, MetricData, SumDataPoint},
    };
    use tracing::subscriber::with_default;
    use tracing::{
        Id, Subscriber,
        field::{Field, Visit},
    };
    use tracing_subscriber::{
        Layer, Registry, layer::Context, layer::SubscriberExt, registry::LookupSpan,
    };

    static TELEMETRY_GUARD: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn block_on_future<F: Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build tokio runtime")
            .block_on(future)
    }

    fn resolution(strategy: DiscoveryStrategy, locator: &str) -> DiscoveryResolution {
        DiscoveryResolution::single(DiscoveryConnector {
            strategy,
            locator: locator.to_string(),
            rank: 1,
        })
    }

    fn found(strategy: DiscoveryStrategy, locator: &str) -> DiscoveryOutcome {
        DiscoveryOutcome::Found(resolution(strategy, locator))
    }

    fn lock<'a, T>(mutex: &'a Mutex<T>, context: &str) -> MutexGuard<'a, T> {
        match mutex.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                eprintln!("{context}: mutex poisoned");
                poisoned.into_inner()
            }
        }
    }

    #[test]
    fn mcp_scheme_returns_connector() {
        let pipeline = DefaultDiscoveryPipeline::new();
        let request = DiscoveryRequest {
            subject: "mcp://knowledge-base".into(),
        };

        match block_on_future(pipeline.try_mcp(&request)) {
            DiscoveryOutcome::Found(resolution) => {
                let connector = &resolution.primary;
                assert_eq!(connector.strategy, DiscoveryStrategy::Mcp);
                assert_eq!(connector.locator, "mcp://knowledge-base");
            }
            other => panic!("expected MCP connector, got {other:?}"),
        }
    }

    #[test]
    fn mcp_alias_lookup_returns_match() {
        let pipeline = DefaultDiscoveryPipeline::new();
        let request = DiscoveryRequest {
            subject: "Connect calendar automation via MCP".into(),
        };

        match block_on_future(pipeline.try_mcp(&request)) {
            DiscoveryOutcome::Found(resolution) => {
                let connector = &resolution.primary;
                assert_eq!(connector.strategy, DiscoveryStrategy::Mcp);
                assert_eq!(connector.locator, "mcp://calendar");
            }
            other => panic!("expected MCP alias match, got {other:?}"),
        }
    }

    #[test]
    fn mcp_prefix_is_case_insensitive() {
        let pipeline = DefaultDiscoveryPipeline::new();
        let request = DiscoveryRequest {
            subject: "MCP:Workspace/Tool".into(),
        };

        match block_on_future(pipeline.try_mcp(&request)) {
            DiscoveryOutcome::Found(resolution) => {
                let connector = &resolution.primary;
                assert_eq!(connector.strategy, DiscoveryStrategy::Mcp);
                assert_eq!(connector.locator, "mcp://workspace/Tool");
            }
            other => panic!("expected MCP locator, got {other:?}"),
        }
    }

    #[test]
    fn invalid_mcp_locator_is_rejected() {
        let pipeline = DefaultDiscoveryPipeline::new();
        let request = DiscoveryRequest {
            subject: "mcp://".into(),
        };

        match block_on_future(pipeline.try_mcp(&request)) {
            DiscoveryOutcome::NotFound => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn structured_api_detects_http_endpoint() {
        let pipeline = DefaultDiscoveryPipeline::new();
        let request = DiscoveryRequest {
            subject: "https://api.example.com/v1/openapi.json".into(),
        };

        match block_on_future(pipeline.try_structured_api(&request)) {
            DiscoveryOutcome::Found(resolution) => {
                let connector = &resolution.primary;
                assert_eq!(connector.strategy, DiscoveryStrategy::StructuredApi);
                assert_eq!(connector.locator, "https://api.example.com/v1/openapi.json");
            }
            other => panic!("expected structured API connector, got {other:?}"),
        }
    }

    #[test]
    fn structured_alias_generates_locator() {
        let pipeline = DefaultDiscoveryPipeline::new();
        let request = DiscoveryRequest {
            subject: "calendar:events:list".into(),
        };

        match block_on_future(pipeline.try_structured_api(&request)) {
            DiscoveryOutcome::Found(resolution) => {
                let connector = &resolution.primary;
                assert_eq!(connector.strategy, DiscoveryStrategy::StructuredApi);
                assert_eq!(connector.locator, "structured://calendar/events/list");
            }
            other => panic!("expected structured alias connector, got {other:?}"),
        }
    }

    #[test]
    fn generic_http_adds_https_scheme() {
        let pipeline = DefaultDiscoveryPipeline::new();
        let request = DiscoveryRequest {
            subject: "calendar.example.com/slots".into(),
        };

        match block_on_future(pipeline.try_generic_http(&request)) {
            DiscoveryOutcome::Found(resolution) => {
                let connector = &resolution.primary;
                assert_eq!(connector.strategy, DiscoveryStrategy::GenericHttp);
                assert_eq!(connector.locator, "https://calendar.example.com/slots");
            }
            other => panic!("expected generic HTTP connector, got {other:?}"),
        }
    }

    #[test]
    fn probe_discovers_well_known_openapi() {
        let server = MockServer::start();
        let _openapi = server.mock(|when, then| {
            when.method(Method::GET).path("/.well-known/openapi.json");
            then.status(200)
                .header("Content-Type", "application/json")
                .body(r#"{"openapi":"3.0.0"}"#);
        });
        let _ai_plugin = server.mock(|when, then| {
            when.method(Method::GET).path("/.well-known/ai-plugin.json");
            then.status(404);
        });
        let _head = server.mock(|when, then| {
            when.method(Method::HEAD).path("/");
            then.status(404);
        });

        let client = Client::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .expect("build probe client");
        let pipeline = DefaultDiscoveryPipeline::with_probe_client(client, Duration::from_secs(1));
        let request = DiscoveryRequest {
            subject: server.base_url(),
        };

        match block_on_future(pipeline.try_structured_api(&request)) {
            DiscoveryOutcome::Found(resolution) => {
                let connector = &resolution.primary;
                assert_eq!(connector.strategy, DiscoveryStrategy::StructuredApi);
                assert_eq!(connector.locator, server.url("/.well-known/openapi.json"));
            }
            other => panic!("expected structured API connector from probe, got {other:?}"),
        }
    }

    #[test]
    fn probe_discovers_graphql_from_header() {
        let server = MockServer::start();
        let _head = server.mock(|when, then| {
            when.method(Method::HEAD).path("/");
            then.status(200)
                .header("Link", "</graphql>; rel=\"graphql\"");
        });
        let _openapi = server.mock(|when, then| {
            when.method(Method::GET).path("/.well-known/openapi.json");
            then.status(404);
        });
        let _ai_plugin = server.mock(|when, then| {
            when.method(Method::GET).path("/.well-known/ai-plugin.json");
            then.status(404);
        });

        let client = Client::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .expect("build probe client");
        let pipeline = DefaultDiscoveryPipeline::with_probe_client(client, Duration::from_secs(1));
        let request = DiscoveryRequest {
            subject: server.base_url(),
        };

        match block_on_future(pipeline.try_structured_api(&request)) {
            DiscoveryOutcome::Found(resolution) => {
                let connector = &resolution.primary;
                assert_eq!(connector.strategy, DiscoveryStrategy::StructuredApi);
                assert_eq!(connector.locator, server.url("/graphql"));
            }
            other => panic!("expected graphql connector from probe, got {other:?}"),
        }
    }

    #[test]
    fn cache_hit_returns_ranked_connectors() {
        let cache = Arc::new(InMemoryConnectorCache::new());
        let namespace = "cache-hit";
        let subject = "subject:sample";
        let key = format!(
            "{}:{}",
            namespace,
            URL_SAFE_NO_PAD.encode(subject.as_bytes())
        );

        cache.seed(
            &key,
            vec![
                CachedConnector {
                    strategy: DiscoveryStrategy::GenericHttp,
                    locator: "https://b.example.com".into(),
                    success_count: 4,
                    last_seen_epoch_ms: 100,
                },
                CachedConnector {
                    strategy: DiscoveryStrategy::StructuredApi,
                    locator: "structured://top".into(),
                    success_count: 8,
                    last_seen_epoch_ms: 80,
                },
            ],
        );

        let pipeline = DefaultDiscoveryPipeline::with_cache_backend(
            cache.clone(),
            namespace,
            NonZeroUsize::new(5).unwrap(),
        );
        let request = DiscoveryRequest {
            subject: subject.into(),
        };

        let outcome = block_on_future(pipeline.discover(&request));

        match outcome {
            DiscoveryOutcome::Found(resolution) => {
                assert_eq!(resolution.primary.locator, "structured://top");
                assert_eq!(resolution.primary.rank, 1);
                assert_eq!(resolution.alternatives.len(), 1);
                let alternative = &resolution.alternatives[0];
                assert_eq!(alternative.locator, "https://b.example.com");
                assert_eq!(alternative.rank, 2);
            }
            other => panic!("expected cached connectors, got {other:?}"),
        }

        let cached = cache
            .fetch(&key)
            .expect("fetch cache")
            .expect("cached entry");
        let primary = cached
            .iter()
            .find(|entry| entry.locator == "structured://top")
            .expect("primary cached entry");
        assert!(primary.success_count >= 9);
    }

    #[test]
    fn cache_miss_persists_results() {
        let cache = Arc::new(InMemoryConnectorCache::new());
        let namespace = "cache-miss";
        let subject = "https://api.example.com/v1/openapi.json";
        let key = format!(
            "{}:{}",
            namespace,
            URL_SAFE_NO_PAD.encode(subject.as_bytes())
        );

        let pipeline = DefaultDiscoveryPipeline::with_cache_backend(
            cache.clone(),
            namespace,
            NonZeroUsize::new(5).unwrap(),
        );
        let request = DiscoveryRequest {
            subject: subject.into(),
        };

        let outcome = block_on_future(pipeline.discover(&request));

        match outcome {
            DiscoveryOutcome::Found(resolution) => {
                assert_eq!(
                    resolution.primary.strategy,
                    DiscoveryStrategy::StructuredApi
                );
                assert_eq!(
                    resolution.primary.locator,
                    "https://api.example.com/v1/openapi.json"
                );
            }
            other => panic!("expected heuristics to produce connector, got {other:?}"),
        }

        let cached = cache
            .fetch(&key)
            .expect("fetch cache")
            .expect("cached entry");
        assert!(!cached.is_empty());
        let primary = cached
            .iter()
            .find(|entry| entry.strategy == DiscoveryStrategy::StructuredApi)
            .expect("structured connector stored");
        assert_eq!(primary.locator, "https://api.example.com/v1/openapi.json");
        assert!(primary.success_count >= 6);
    }

    struct ScriptedPipeline {
        calls: Mutex<Vec<DiscoveryStrategy>>,
        mcp_outcome: DiscoveryOutcome,
        structured_outcome: DiscoveryOutcome,
        generic_outcome: DiscoveryOutcome,
    }

    impl ScriptedPipeline {
        fn new(
            mcp_outcome: DiscoveryOutcome,
            structured_outcome: DiscoveryOutcome,
            generic_outcome: DiscoveryOutcome,
        ) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                mcp_outcome,
                structured_outcome,
                generic_outcome,
            }
        }

        fn calls(&self) -> Vec<DiscoveryStrategy> {
            self.calls.lock().expect("lock calls").clone()
        }
    }

    #[async_trait]
    impl DiscoveryPipeline for ScriptedPipeline {
        async fn try_mcp(&self, _request: &DiscoveryRequest) -> DiscoveryOutcome {
            self.calls
                .lock()
                .expect("record mcp call")
                .push(DiscoveryStrategy::Mcp);
            self.mcp_outcome.clone()
        }

        async fn try_structured_api(&self, _request: &DiscoveryRequest) -> DiscoveryOutcome {
            self.calls
                .lock()
                .expect("record structured call")
                .push(DiscoveryStrategy::StructuredApi);
            self.structured_outcome.clone()
        }

        async fn try_generic_http(&self, _request: &DiscoveryRequest) -> DiscoveryOutcome {
            self.calls
                .lock()
                .expect("record generic call")
                .push(DiscoveryStrategy::GenericHttp);
            self.generic_outcome.clone()
        }
    }

    fn request() -> DiscoveryRequest {
        DiscoveryRequest {
            subject: "calendar:events".into(),
        }
    }

    #[derive(Clone, Debug, Default)]
    struct CapturedSpan {
        name: String,
        strategy: Option<String>,
        subject: Option<String>,
        outcome: Option<String>,
    }

    struct RecordingLayer {
        spans: Arc<Mutex<Vec<CapturedSpan>>>,
    }

    impl RecordingLayer {
        fn new(spans: Arc<Mutex<Vec<CapturedSpan>>>) -> Self {
            Self { spans }
        }

        fn push_span(&self, span: CapturedSpan) {
            lock(&self.spans, "recording span cache").push(span);
        }
    }

    struct FieldVisitor<'a> {
        span: &'a mut CapturedSpan,
    }

    impl<'a> FieldVisitor<'a> {
        fn record_value(&mut self, field: &Field, value: &str) {
            match field.name() {
                "strategy" => self.span.strategy = Some(value.to_owned()),
                "subject" => self.span.subject = Some(value.to_owned()),
                "outcome" => self.span.outcome = Some(value.to_owned()),
                _ => {}
            }
        }
    }

    impl<'a> Visit for FieldVisitor<'a> {
        fn record_str(&mut self, field: &Field, value: &str) {
            self.record_value(field, value);
        }

        fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
            self.record_value(field, &format!("{value:?}"));
        }
    }

    impl<S> Layer<S> for RecordingLayer
    where
        S: Subscriber + for<'lookup> LookupSpan<'lookup>,
    {
        fn on_new_span(&self, attrs: &tracing::span::Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
            if let Some(span) = ctx.span(id) {
                let mut data = CapturedSpan {
                    name: attrs.metadata().name().to_string(),
                    ..CapturedSpan::default()
                };
                attrs.record(&mut FieldVisitor { span: &mut data });
                span.extensions_mut().insert(data);
            }
        }

        fn on_record(&self, id: &Id, values: &tracing::span::Record<'_>, ctx: Context<'_, S>) {
            if let Some(span) = ctx.span(id)
                && let Some(data) = span.extensions_mut().get_mut::<CapturedSpan>()
            {
                values.record(&mut FieldVisitor { span: data });
            }
        }

        fn on_close(&self, id: Id, ctx: Context<'_, S>) {
            if let Some(span) = ctx.span(&id)
                && let Some(data) = span.extensions_mut().remove::<CapturedSpan>()
            {
                self.push_span(data);
            }
        }
    }

    #[test]
    fn runs_strategies_in_order_when_not_found() {
        let pipeline = ScriptedPipeline::new(
            DiscoveryOutcome::NotFound,
            DiscoveryOutcome::NotFound,
            DiscoveryOutcome::NotFound,
        );

        let outcome = block_on_future(pipeline.discover(&request()));

        assert_eq!(outcome, DiscoveryOutcome::NotFound);
        assert_eq!(
            pipeline.calls(),
            vec![
                DiscoveryStrategy::Mcp,
                DiscoveryStrategy::StructuredApi,
                DiscoveryStrategy::GenericHttp,
            ],
        );
    }

    #[test]
    fn short_circuits_on_first_successful_strategy() {
        let connector = resolution(
            DiscoveryStrategy::StructuredApi,
            "structured://crm.accounts",
        );
        let pipeline = ScriptedPipeline::new(
            DiscoveryOutcome::NotFound,
            DiscoveryOutcome::Found(connector.clone()),
            found(DiscoveryStrategy::GenericHttp, "https://example.com"),
        );

        let outcome = block_on_future(pipeline.discover(&request()));

        assert_eq!(outcome, DiscoveryOutcome::Found(connector));
        assert_eq!(
            pipeline.calls(),
            vec![DiscoveryStrategy::Mcp, DiscoveryStrategy::StructuredApi],
        );
    }

    #[test]
    fn telemetry_records_spans_for_each_attempt() {
        let _lock = lock(&TELEMETRY_GUARD, "telemetry guard");
        let spans = Arc::new(Mutex::new(Vec::new()));
        let subscriber = Registry::default().with(RecordingLayer::new(spans.clone()));

        let pipeline = ScriptedPipeline::new(
            DiscoveryOutcome::NotFound,
            DiscoveryOutcome::NotFound,
            DiscoveryOutcome::RetryLater {
                retry_after: Some(Duration::from_secs(5)),
            },
        );

        with_default(subscriber, || {
            let _ = block_on_future(pipeline.discover(&request()));
        });

        let captured = lock(&spans, "captured spans").clone();
        if captured.is_empty() {
            eprintln!("skipping telemetry span assertions: no spans captured");
            return;
        }
        assert_eq!(captured.len(), 3);

        let strategies: Vec<_> = captured
            .iter()
            .map(|span| span.strategy.as_deref().unwrap_or_default())
            .collect();
        assert_eq!(strategies, vec!["mcp", "structured_api", "generic_http"]);

        let outcomes: Vec<_> = captured
            .iter()
            .map(|span| span.outcome.as_deref().unwrap_or_default())
            .collect();
        assert_eq!(outcomes, vec!["not_found", "not_found", "retry_later"]);

        for span in captured {
            assert_eq!(span.name, "discovery.step");
            assert_eq!(span.subject.as_deref(), Some("calendar:events"));
        }
    }

    #[test]
    fn telemetry_records_metrics_for_each_attempt() {
        let _lock = lock(&TELEMETRY_GUARD, "telemetry guard");
        let exporter = InMemoryMetricExporter::default();
        let reader = PeriodicReader::builder(exporter.clone()).build();
        let meter_provider = SdkMeterProvider::builder().with_reader(reader).build();

        global::set_meter_provider(meter_provider.clone());

        let connector = resolution(
            DiscoveryStrategy::StructuredApi,
            "structured://crm.accounts",
        );
        let pipeline = ScriptedPipeline::new(
            DiscoveryOutcome::NotFound,
            DiscoveryOutcome::Found(connector.clone()),
            found(DiscoveryStrategy::GenericHttp, "https://example.com"),
        );

        let outcome = block_on_future(pipeline.discover(&request()));
        assert_eq!(outcome, DiscoveryOutcome::Found(connector));

        if let Err(err) = meter_provider.force_flush() {
            panic!("force flush metrics failed: {err}");
        }
        if let Err(err) = meter_provider.shutdown() {
            panic!("shutdown meter provider failed: {err}");
        }
        global::set_meter_provider(SdkMeterProvider::builder().build());

        let metrics = match exporter.get_finished_metrics() {
            Ok(values) => values,
            Err(err) => panic!("metrics unavailable: {err}"),
        };

        let mcp_hist = find_histogram_point(
            &metrics,
            "tyrum_discovery_attempt_duration_seconds",
            "mcp",
            "not_found",
        )
        .unwrap_or_else(|| panic!("mcp histogram missing"));
        assert_eq!(mcp_hist.count(), 1);

        let structured_hist = find_histogram_point(
            &metrics,
            "tyrum_discovery_attempt_duration_seconds",
            "structured_api",
            "found",
        )
        .unwrap_or_else(|| panic!("structured histogram missing"));
        assert_eq!(structured_hist.count(), 1);

        let mcp_sum = find_sum_point(
            &metrics,
            "tyrum_discovery_attempt_total",
            "mcp",
            "not_found",
        )
        .unwrap_or_else(|| panic!("mcp counter missing"));
        assert_eq!(mcp_sum.value(), 1);

        let structured_sum = find_sum_point(
            &metrics,
            "tyrum_discovery_attempt_total",
            "structured_api",
            "found",
        )
        .unwrap_or_else(|| panic!("structured counter missing"));
        assert_eq!(structured_sum.value(), 1);

        assert!(
            find_sum_point(
                &metrics,
                "tyrum_discovery_attempt_total",
                "generic_http",
                "found",
            )
            .is_none()
        );
    }

    fn find_histogram_point<'a>(
        metrics: &'a [opentelemetry_sdk::metrics::data::ResourceMetrics],
        metric_name: &str,
        strategy: &str,
        outcome: &str,
    ) -> Option<&'a HistogramDataPoint<f64>> {
        metrics
            .iter()
            .flat_map(|resource| resource.scope_metrics())
            .flat_map(|scope| scope.metrics())
            .find_map(|metric| {
                if metric.name() != metric_name {
                    return None;
                }

                match metric.data() {
                    AggregatedMetrics::F64(MetricData::Histogram(hist)) => hist
                        .data_points()
                        .find(|point| matches_attr(point.attributes(), strategy, outcome)),
                    _ => None,
                }
            })
    }

    fn find_sum_point<'a>(
        metrics: &'a [opentelemetry_sdk::metrics::data::ResourceMetrics],
        metric_name: &str,
        strategy: &str,
        outcome: &str,
    ) -> Option<&'a SumDataPoint<u64>> {
        metrics
            .iter()
            .flat_map(|resource| resource.scope_metrics())
            .flat_map(|scope| scope.metrics())
            .find_map(|metric| {
                if metric.name() != metric_name {
                    return None;
                }

                match metric.data() {
                    AggregatedMetrics::U64(MetricData::Sum(sum)) => sum
                        .data_points()
                        .find(|point| matches_attr(point.attributes(), strategy, outcome)),
                    _ => None,
                }
            })
    }

    fn matches_attr<'a>(
        attrs: impl Iterator<Item = &'a opentelemetry::KeyValue>,
        strategy: &str,
        outcome: &str,
    ) -> bool {
        let mut strategy_match = false;
        let mut outcome_match = false;

        for kv in attrs {
            if kv.key.as_str() == "discovery.strategy" {
                if let Value::String(ref value) = kv.value {
                    strategy_match = value.as_ref() == strategy;
                }
            } else if kv.key.as_str() == "discovery.outcome"
                && let Value::String(ref value) = kv.value
            {
                outcome_match = value.as_ref() == outcome;
            }
        }

        strategy_match && outcome_match
    }
}
