#![allow(clippy::expect_used, clippy::unwrap_used)]

use axum::Router;
use reqwest::Url;
use tokio::{net::TcpListener, task::JoinHandle};
use tyrum_planner::WalletClient;
use tyrum_wallet::{Thresholds, build_router};

#[allow(dead_code)]
pub async fn start_wallet_stub(thresholds: Thresholds) -> (WalletClient, JoinHandle<()>) {
    let router: Router = build_router(thresholds);

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind wallet listener");
    let addr = listener.local_addr().expect("wallet socket address");
    let url = Url::parse(&format!("http://{}", addr)).expect("wallet client url");

    let server = tokio::spawn(async move {
        axum::serve(listener, router)
            .await
            .expect("wallet server failed");
    });

    let client = WalletClient::new(url);

    (client, server)
}
