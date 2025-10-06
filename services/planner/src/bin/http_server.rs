use std::{env, net::SocketAddr};

use reqwest::Url;
use tokio::net::TcpListener;
use tracing_subscriber::{EnvFilter, fmt};

use tyrum_planner::http::{DEFAULT_BIND_ADDR, PlannerState, build_router};
use tyrum_planner::policy::PolicyClient;

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    init_tracing();

    let bind_addr: SocketAddr = env::var("PLANNER_BIND_ADDR")
        .unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string())
        .parse()
        .expect("invalid PLANNER_BIND_ADDR");

    let policy_url = env::var("POLICY_GATE_URL").expect("POLICY_GATE_URL must be set");
    let policy_client =
        PolicyClient::new(Url::parse(&policy_url).expect("invalid POLICY_GATE_URL"));

    let app = build_router(PlannerState { policy_client });
    let listener = TcpListener::bind(bind_addr)
        .await
        .expect("bind planner socket");

    tracing::info!(%bind_addr, "planner HTTP server listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("planner HTTP server exited unexpectedly");
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,tyrum_planner=info,planner_http=info"));

    fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .try_init()
        .expect("install tracing subscriber");
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        tracing::warn!(%error, "ctrl-c handler failed");
    }
    tracing::info!("shutdown signal received");
}
