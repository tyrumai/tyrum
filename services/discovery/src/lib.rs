//! Discovery pipeline interfaces and default stub implementation.

mod cache;
mod telemetry;

pub mod pipeline;

pub use pipeline::{
    DefaultDiscoveryPipeline, DiscoveryCacheSettings, DiscoveryConnector, DiscoveryOutcome,
    DiscoveryPipeline, DiscoveryPipelineConfig, DiscoveryRequest, DiscoveryResolution,
    DiscoveryStrategy,
};

pub use cache::{CacheError, RedisConnectorCache};

#[cfg(any(test, feature = "test-support"))]
pub use cache::InMemoryConnectorCache;
