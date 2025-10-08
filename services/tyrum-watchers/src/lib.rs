//! JetStream client utilities for Tyrum watcher processing.

pub mod config;
mod error;
pub mod jetstream;
pub mod processor;

pub use config::JetStreamConfig;
pub use error::{JetStreamError, PlannerClientError, WatcherProcessorError};
pub use jetstream::{JetStreamClient, JetStreamHealth};
pub use processor::{
    PlannerClient, RecordedWatcherOutcome, WatcherEvent, WatcherProcessor, WatcherProcessorBuilder,
    WatcherProcessorConfig,
};
