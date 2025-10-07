use std::{env, net::SocketAddr};

use anyhow::Context;
use axum::{Json, Router, routing::get};
use tokio::signal;
use tracing::info;
use tyrum_executor_cli::{sandbox_summary, telemetry::TelemetryGuard};

const DEFAULT_BIND_ADDR: &str = "0.0.0.0:8093";
const BIND_ADDR_ENV: &str = "CLI_EXECUTOR_BIND_ADDR";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _telemetry = TelemetryGuard::install("tyrum-executor-cli").context("install telemetry")?;

    let bind_addr = resolve_bind_addr()?;
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .context("bind cli executor listener")?;

    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/sandbox", get(|| async { Json(sandbox_summary()) }));

    info!(%bind_addr, "cli executor listening");

    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("serve cli executor")
}

fn resolve_bind_addr() -> anyhow::Result<SocketAddr> {
    let bind = env::var(BIND_ADDR_ENV).unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string());
    bind.parse().context("parse CLI_EXECUTOR_BIND_ADDR")
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c().await.expect("install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{SignalKind, signal};
        if let Ok(mut sigterm) = signal(SignalKind::terminate()) {
            sigterm.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    info!("shutdown signal received");
}
