use std::{env, net::SocketAddr};

use anyhow::Context;
use axum::{Json, Router, routing::get};
use tokio::signal;
use tracing::{info, warn};
use tyrum_executor_web::{sandbox_constraints, telemetry::TelemetryGuard};

const DEFAULT_BIND_ADDR: &str = "0.0.0.0:8091";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _telemetry = TelemetryGuard::install("tyrum-executor-web").context("install telemetry")?;

    let bind_addr = resolve_bind_addr()?;
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .context("bind web executor listener")?;

    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/sandbox", get(|| async { Json(sandbox_constraints()) }));

    info!(%bind_addr, "web executor listening");

    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("serve web executor")
}

fn resolve_bind_addr() -> anyhow::Result<SocketAddr> {
    let bind = env::var("WEB_EXECUTOR_BIND_ADDR").unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string());
    bind.parse().context("parse WEB_EXECUTOR_BIND_ADDR")
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(err) = signal::ctrl_c().await {
            warn!(error = %err, "Ctrl+C handler not available");
        }
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
