use std::{env, net::SocketAddr};

use anyhow::{Context, Result, anyhow};
use tokio::net::TcpListener;
use tracing::warn;
use tracing_subscriber::{EnvFilter, fmt};

const DEFAULT_BIND_ADDR: &str = "0.0.0.0:8090";
const DEFAULT_CONFIG: &str = include_str!("../../config/default_weights.toml");

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<()> {
    init_tracing()?;

    let bind_addr: SocketAddr = env::var("RISK_CLASSIFIER_BIND_ADDR")
        .unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string())
        .parse()
        .context("invalid RISK_CLASSIFIER_BIND_ADDR")?;

    let classifier = match env::var("RISK_CLASSIFIER_CONFIG") {
        Ok(path) if !path.trim().is_empty() => {
            tyrum_risk_classifier::load_classifier_from_path(&path)
                .with_context(|| format!("load config from {path}"))?
        }
        _ => tyrum_risk_classifier::load_classifier_from_toml_str(DEFAULT_CONFIG)
            .context("load bundled default config")?,
    };

    let app = tyrum_risk_classifier::http::router(classifier);

    let listener = TcpListener::bind(bind_addr)
        .await
        .context("bind risk classifier socket")?;
    tracing::info!(%bind_addr, "risk classifier stub listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("risk classifier server exited unexpectedly")?;

    Ok(())
}

fn init_tracing() -> Result<()> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,tyrum_risk_classifier=info"));

    fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .try_init()
        .map_err(|err| anyhow!("install tracing subscriber: {err}"))
}

#[allow(clippy::cognitive_complexity)]
async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        warn!(%error, "ctrl-c handler failed");
    }
    tracing::info!("risk classifier shutting down");
}
