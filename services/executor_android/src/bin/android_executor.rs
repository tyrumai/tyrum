use std::{env, net::SocketAddr, sync::Arc};

use anyhow::Context;
use axum::{Json, Router, extract::State, routing::get};
use tokio::signal;
use tracing::info;
use tyrum_executor_android::{
    AndroidExecutorConfig, AndroidSandboxSummary, sandbox_summary, telemetry::TelemetryGuard,
};

const DEFAULT_BIND_ADDR: &str = "0.0.0.0:8094";

#[derive(Clone)]
struct AppState {
    summary: Arc<AndroidSandboxSummary>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _telemetry =
        TelemetryGuard::install("tyrum-executor-android").context("install telemetry")?;

    let config = AndroidExecutorConfig::from_env();
    let state = AppState {
        summary: Arc::new(sandbox_summary(&config)),
    };

    let bind_addr = resolve_bind_addr()?;
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .context("bind android executor listener")?;

    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/sandbox", get(sandbox))
        .with_state(state);

    info!(%bind_addr, "android executor listening");

    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("serve android executor")
}

fn resolve_bind_addr() -> anyhow::Result<SocketAddr> {
    let bind =
        env::var("ANDROID_EXECUTOR_BIND_ADDR").unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string());
    bind.parse().context("parse ANDROID_EXECUTOR_BIND_ADDR")
}

async fn sandbox(State(state): State<AppState>) -> Json<AndroidSandboxSummary> {
    Json((*state.summary).clone())
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
