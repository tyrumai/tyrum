use std::{env, net::SocketAddr};

use tyrum_policy::{DEFAULT_BIND_ADDR, build_router, telemetry::TelemetryGuard};

#[tokio::main]
async fn main() {
    let _telemetry =
        TelemetryGuard::install("tyrum-policy").expect("failed to initialize telemetry");

    let bind_addr: SocketAddr = env::var("POLICY_BIND_ADDR")
        .unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string())
        .parse()
        .expect("invalid POLICY_BIND_ADDR");

    let app = build_router();

    tracing::info!("policy service listening on {}", bind_addr);
    axum::serve(tokio::net::TcpListener::bind(bind_addr).await.unwrap(), app)
        .await
        .expect("policy server exited unexpectedly");
}
