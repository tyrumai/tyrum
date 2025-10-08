use std::{env, io, io::ErrorKind, time::Duration};

use tokio::signal;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use tyrum_watchers::{
    JetStreamClient, JetStreamConfig, PlannerClient, WatcherProcessorBuilder,
    WatcherProcessorConfig,
};

const PLANNER_URL_ENV: &str = "WATCHERS_PLANNER_URL";
const FETCH_TIMEOUT_ENV: &str = "WATCHERS_PROCESSOR_FETCH_TIMEOUT_MS";
const MAX_BATCH_ENV: &str = "WATCHERS_PROCESSOR_MAX_BATCH";
const IDLE_BACKOFF_ENV: &str = "WATCHERS_PROCESSOR_IDLE_BACKOFF_MS";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    init_tracing();

    let jetstream_config = JetStreamConfig::from_env()?;
    let planner_endpoint = require_env(PLANNER_URL_ENV)?;

    let mut processor_config = WatcherProcessorConfig::from_jetstream(&jetstream_config);

    processor_config = maybe_override_fetch_timeout(processor_config);
    processor_config = maybe_override_max_batch(processor_config);
    processor_config = maybe_override_idle_backoff(processor_config);

    let jetstream = JetStreamClient::connect(jetstream_config.clone()).await?;
    let planner = PlannerClient::new(planner_endpoint)?;

    let processor = WatcherProcessorBuilder::new(jetstream, planner)
        .with_config(processor_config)
        .build()
        .await?;

    info!("watcher processor started");

    processor
        .run(shutdown_signal())
        .await
        .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;

    info!("watcher processor stopped");

    Ok(())
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,tyrum_watchers=info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .compact()
        .init();
}

fn require_env(key: &str) -> Result<String, Box<dyn std::error::Error>> {
    env::var(key).map_err(|_| {
        io::Error::new(
            ErrorKind::NotFound,
            format!("missing environment variable {key}"),
        )
        .into()
    })
}

fn maybe_override_fetch_timeout(config: WatcherProcessorConfig) -> WatcherProcessorConfig {
    match env::var(FETCH_TIMEOUT_ENV) {
        Ok(raw) => match raw.parse::<u64>() {
            Ok(ms) => config.with_fetch_timeout(Duration::from_millis(ms)),
            Err(_) => {
                warn!(
                    key = FETCH_TIMEOUT_ENV,
                    value = %raw,
                    "ignoring invalid fetch timeout override"
                );
                config
            }
        },
        Err(_) => config,
    }
}

fn maybe_override_max_batch(config: WatcherProcessorConfig) -> WatcherProcessorConfig {
    match env::var(MAX_BATCH_ENV) {
        Ok(raw) => match raw.parse::<usize>() {
            Ok(max_batch) => config.with_max_batch(max_batch),
            Err(_) => {
                warn!(
                    key = MAX_BATCH_ENV,
                    value = %raw,
                    "ignoring invalid max batch override"
                );
                config
            }
        },
        Err(_) => config,
    }
}

fn maybe_override_idle_backoff(config: WatcherProcessorConfig) -> WatcherProcessorConfig {
    match env::var(IDLE_BACKOFF_ENV) {
        Ok(raw) => match raw.parse::<u64>() {
            Ok(ms) => config.with_idle_backoff(Duration::from_millis(ms)),
            Err(_) => {
                warn!(
                    key = IDLE_BACKOFF_ENV,
                    value = %raw,
                    "ignoring invalid idle backoff override"
                );
                config
            }
        },
        Err(_) => config,
    }
}

async fn shutdown_signal() {
    if let Err(error) = signal::ctrl_c().await {
        warn!(%error, "failed to install Ctrl+C handler");
    }
}
