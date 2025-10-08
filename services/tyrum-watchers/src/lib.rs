//! JetStream client utilities for Tyrum watcher processing.

pub mod config;
mod error;
pub mod jetstream;

pub use config::JetStreamConfig;
pub use error::JetStreamError;
pub use jetstream::{JetStreamClient, JetStreamHealth};
