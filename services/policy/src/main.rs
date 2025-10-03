use std::{env, net::SocketAddr};

use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt};

use tyrum_policy::{DEFAULT_BIND_ADDR, build_router};

fn init_tracing() {
    let env_filter =
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());
    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer())
        .init();
}

#[tokio::main]
async fn main() {
    init_tracing();

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
