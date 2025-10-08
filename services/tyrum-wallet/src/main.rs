use std::{env, net::SocketAddr};

use anyhow::{Context, Result, anyhow};
use tyrum_wallet::{DEFAULT_BIND_ADDR, Thresholds, build_router, telemetry::TelemetryGuard};

#[tokio::main]
async fn main() -> Result<()> {
    let _telemetry = TelemetryGuard::install("tyrum-wallet")
        .map_err(|err| anyhow!("failed to initialize telemetry: {err}"))?;

    let bind_addr: SocketAddr = env::var("WALLET_BIND_ADDR")
        .unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string())
        .parse()
        .context("invalid WALLET_BIND_ADDR")?;

    let thresholds = Thresholds::from_env();
    tracing::info!(
        auto_approve_minor = thresholds.auto_approve_minor_units,
        hard_deny_minor = thresholds.hard_deny_minor_units,
        "wallet thresholds configured"
    );

    let app = build_router(thresholds);

    tracing::info!("wallet service listening on {}", bind_addr);
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .context("bind wallet listener")?;
    axum::serve(listener, app)
        .await
        .context("wallet server exited unexpectedly")?;

    Ok(())
}
