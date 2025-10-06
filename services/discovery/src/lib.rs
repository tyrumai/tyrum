//! Discovery pipeline interfaces and default stub implementation.

pub mod pipeline;

pub use pipeline::{
    DefaultDiscoveryPipeline, DiscoveryConnector, DiscoveryOutcome, DiscoveryPipeline,
    DiscoveryRequest, DiscoveryStrategy,
};
