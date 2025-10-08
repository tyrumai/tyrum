#![allow(clippy::expect_used, clippy::unwrap_used)]

use axum::{Json, Router, routing::post};
use reqwest::Url;
use tokio::{net::TcpListener, task::JoinHandle};
use tyrum_planner::policy::PolicyClient;

#[allow(dead_code)]
pub async fn mock_policy(response: serde_json::Value) -> (PolicyClient, JoinHandle<()>) {
    let body = response;
    let app = Router::new().route(
        "/policy/check",
        post(move || {
            let response = body.clone();
            async move { Json(response) }
        }),
    );

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind policy listener");
    let addr = listener.local_addr().expect("obtain policy addr");
    let url = Url::parse(&format!("http://{}", addr)).expect("construct policy url");

    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("policy server failed");
    });

    let client = PolicyClient::new(url);

    (client, server)
}
