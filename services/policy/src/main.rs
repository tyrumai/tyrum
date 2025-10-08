use std::{env, net::SocketAddr};

use anyhow::{Context, Result, anyhow};
use tyrum_policy::{DEFAULT_BIND_ADDR, build_router, telemetry::TelemetryGuard};

#[tokio::main]
async fn main() -> Result<()> {
    let _telemetry = TelemetryGuard::install("tyrum-policy")
        .map_err(|err| anyhow!("failed to initialize telemetry: {err}"))?;

    let bind_addr: SocketAddr = env::var("POLICY_BIND_ADDR")
        .unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string())
        .parse()
        .context("invalid POLICY_BIND_ADDR")?;

    let app = build_router();

    tracing::info!("policy service listening on {}", bind_addr);
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .context("failed to bind policy listener")?;
    axum::serve(listener, app)
        .await
        .context("policy server exited unexpectedly")?;

    Ok(())
}
