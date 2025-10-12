use std::{env, net::SocketAddr, num::NonZeroUsize, sync::Arc, time::Duration};

use anyhow::{Context, Result, anyhow};
use reqwest::Url;
use tokio::net::TcpListener;
use tracing::{info, warn};
use tracing_subscriber::{EnvFilter, fmt};

use tyrum_discovery::{DefaultDiscoveryPipeline, DiscoveryCacheSettings, DiscoveryPipelineConfig};
use tyrum_memory::MemoryDal;
use tyrum_planner::capability_memory::CapabilityMemoryService;
use tyrum_planner::http::{DEFAULT_BIND_ADDR, PlannerState, build_router};
use tyrum_planner::policy::PolicyClient;
use tyrum_planner::{EventLog, EventLogSettings, ProfileStore, WalletClient};
use tyrum_risk_classifier::RiskClassifier;

const RISK_CLASSIFIER_CONFIG_ENV: &str = "PLANNER_RISK_CLASSIFIER_CONFIG";

const EVENT_LOG_URL_ENV: &str = "PLANNER_EVENT_LOG_URL";
const WALLET_GATE_URL_ENV: &str = "WALLET_GATE_URL";
const DISCOVERY_PROBE_TIMEOUT_MS_ENV: &str = "DISCOVERY_PROBE_TIMEOUT_MS";

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<()> {
    init_tracing()?;

    let bind_addr: SocketAddr = env::var("PLANNER_BIND_ADDR")
        .unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string())
        .parse()
        .context("invalid PLANNER_BIND_ADDR")?;

    let policy_url = env::var("POLICY_GATE_URL").context("POLICY_GATE_URL must be set")?;
    let policy_client = PolicyClient::new(
        Url::parse(&policy_url).map_err(|err| anyhow!("invalid POLICY_GATE_URL: {err}"))?,
    );

    let wallet_url =
        env::var(WALLET_GATE_URL_ENV).context(format!("{} must be set", WALLET_GATE_URL_ENV))?;
    let wallet_client = WalletClient::new(
        Url::parse(&wallet_url).map_err(|err| anyhow!("invalid WALLET_GATE_URL: {err}"))?,
    );

    let event_log_url =
        env::var(EVENT_LOG_URL_ENV).context(format!("{} must be set", EVENT_LOG_URL_ENV))?;
    let event_log = EventLog::connect(EventLogSettings::new(event_log_url))
        .await
        .context("connect planner event log")?;
    event_log
        .migrate()
        .await
        .context("run planner migrations")?;
    let profiles = ProfileStore::new(event_log.pool().clone());
    let capability_memory = CapabilityMemoryService::new(MemoryDal::new(event_log.pool().clone()));
    let discovery_pipeline = build_discovery_pipeline();

    let risk_classifier = load_risk_classifier();

    let app = build_router(PlannerState {
        policy_client,
        event_log,
        discovery: Arc::new(discovery_pipeline),
        wallet_client,
        profiles,
        capability_memory,
        risk_classifier,
    });
    let listener = TcpListener::bind(bind_addr)
        .await
        .context("bind planner socket")?;

    tracing::info!(%bind_addr, "planner HTTP server listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("planner HTTP server exited unexpectedly")?;

    Ok(())
}

fn build_discovery_pipeline() -> DefaultDiscoveryPipeline {
    let probe_timeout_ms = env::var(DISCOVERY_PROBE_TIMEOUT_MS_ENV)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(1_500);
    let probe_timeout = Duration::from_millis(probe_timeout_ms);

    let redis_url = match env::var("REDIS_URL") {
        Ok(url) if !url.trim().is_empty() => url,
        _ => return DefaultDiscoveryPipeline::with_probe_timeout(probe_timeout),
    };

    let ttl_seconds = env::var("DISCOVERY_CACHE_TTL_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(900);
    let ttl = Duration::from_secs(ttl_seconds);

    let top_k = env::var("DISCOVERY_CACHE_TOP_K")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .and_then(NonZeroUsize::new)
        .unwrap_or_else(|| NonZeroUsize::new(5).unwrap_or(NonZeroUsize::MIN));

    let settings = DiscoveryCacheSettings::new(redis_url, "discovery", ttl);

    match DefaultDiscoveryPipeline::from_config(DiscoveryPipelineConfig {
        cache: Some(settings),
        top_k,
        probe_timeout,
    }) {
        Ok(pipeline) => pipeline,
        Err(error) => {
            warn!(%error, "failed to initialize Redis cache for discovery; continuing without caching");
            DefaultDiscoveryPipeline::with_probe_timeout(probe_timeout)
        }
    }
}

fn init_tracing() -> Result<()> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,tyrum_planner=info,planner_http=info"));

    fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .try_init()
        .map_err(|err| anyhow!("install tracing subscriber: {err}"))?;

    Ok(())
}

#[allow(clippy::cognitive_complexity)]
async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        tracing::warn!(%error, "ctrl-c handler failed");
    }
    tracing::info!("shutdown signal received");
}

#[allow(clippy::cognitive_complexity)]
fn load_risk_classifier() -> Option<RiskClassifier> {
    match env::var(RISK_CLASSIFIER_CONFIG_ENV) {
        Ok(path) if !path.trim().is_empty() => {
            match tyrum_risk_classifier::load_classifier_from_path(&path) {
                Ok(classifier) => {
                    info!(config = %path, "risk classifier enabled");
                    Some(classifier)
                }
                Err(error) => {
                    warn!(%error, config = %path, "failed to load risk classifier config; continuing without classifier");
                    None
                }
            }
        }
        _ => None,
    }
}
