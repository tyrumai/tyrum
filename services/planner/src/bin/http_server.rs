use std::{env, net::SocketAddr, sync::Arc};

use anyhow::{Context, Result, anyhow};
use reqwest::Url;
use tokio::net::TcpListener;
use tracing_subscriber::{EnvFilter, fmt};

use tyrum_discovery::DefaultDiscoveryPipeline;
use tyrum_planner::http::{DEFAULT_BIND_ADDR, PlannerState, build_router};
use tyrum_planner::policy::PolicyClient;
use tyrum_planner::{EventLog, EventLogSettings, WalletClient};

const EVENT_LOG_URL_ENV: &str = "PLANNER_EVENT_LOG_URL";
const WALLET_GATE_URL_ENV: &str = "WALLET_GATE_URL";

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

    let app = build_router(PlannerState {
        policy_client,
        event_log,
        discovery: Arc::new(DefaultDiscoveryPipeline::new()),
        wallet_client,
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
