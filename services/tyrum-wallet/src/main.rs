use std::{env, net::SocketAddr};

use tyrum_wallet::{DEFAULT_BIND_ADDR, Thresholds, build_router, telemetry::TelemetryGuard};

#[tokio::main]
async fn main() {
    let _telemetry =
        TelemetryGuard::install("tyrum-wallet").expect("failed to initialize telemetry");

    let bind_addr: SocketAddr = env::var("WALLET_BIND_ADDR")
        .unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string())
        .parse()
        .expect("invalid WALLET_BIND_ADDR");

    let thresholds = Thresholds::from_env();
    tracing::info!(
        auto_approve_minor = thresholds.auto_approve_minor_units,
        hard_deny_minor = thresholds.hard_deny_minor_units,
        "wallet thresholds configured"
    );

    let app = build_router(thresholds);

    tracing::info!("wallet service listening on {}", bind_addr);
    let listener = tokio::net::TcpListener::bind(bind_addr).await.unwrap();
    axum::serve(listener, app)
        .await
        .expect("wallet server exited unexpectedly");
}
