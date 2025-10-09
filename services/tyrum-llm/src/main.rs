use anyhow::Context;
use tokio::net::TcpListener;
use tracing::info;

use tyrum_llm::{AppState, GatewaySettings, build_router, init_tracing};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing()?;

    let settings = GatewaySettings::from_env()?;
    let bind_addr = settings.bind_addr.clone();
    let state = AppState::try_from(&settings)?;
    let router = build_router(state);

    let listener = TcpListener::bind(&bind_addr)
        .await
        .with_context(|| format!("binding llm gateway on {bind_addr}"))?;

    info!(
        bind = %bind_addr,
        upstream = %settings.vllm_endpoint,
        model = %settings.model,
        "llm gateway listening"
    );

    axum::serve(listener, router).await?;
    Ok(())
}
