use std::time::Duration;

use anyhow::Result;
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
    routing::post,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tower::ServiceExt;
use url::Url;

use tyrum_llm::{AppState, RateLimitSettings, build_router};

#[tokio::test]
async fn forwards_requests_and_normalises_response() -> Result<()> {
    let addr = spawn_mock_vllm().await?;
    let endpoint = Url::parse(&format!("http://{addr}/v1/completions"))?;
    let client = reqwest::Client::builder().build()?;
    let rate_limit = RateLimitSettings::new(100, Duration::from_secs(1));
    let state = AppState::from_parts(client, endpoint, "test-model", 64, rate_limit);
    let router = build_router(state);

    let request = Request::builder()
        .method(Method::POST)
        .uri("/completions")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "prompt": "hello tyrum",
                "max_tokens": 32
            })
            .to_string(),
        ))?;

    let response = router.oneshot(request).await?;
    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await?;
    let parsed: Value = serde_json::from_slice(&body)?;
    assert_eq!(parsed["model"], "test-model");
    assert_eq!(parsed["choices"][0]["text"], "Echo: hello tyrum");
    assert_eq!(parsed["usage"]["prompt_tokens"], 3);

    Ok(())
}

#[tokio::test]
async fn surfaces_upstream_errors() -> Result<()> {
    let addr = spawn_failing_vllm().await?;
    let endpoint = Url::parse(&format!("http://{addr}/v1/completions"))?;
    let client = reqwest::Client::builder().build()?;
    let rate_limit = RateLimitSettings::new(100, Duration::from_secs(1));
    let state = AppState::from_parts(client, endpoint, "test-model", 64, rate_limit);
    let router = build_router(state);

    let request = Request::builder()
        .method(Method::POST)
        .uri("/completions")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "prompt": "failure please",
            })
            .to_string(),
        ))?;

    let response = router.oneshot(request).await?;
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);

    let body = to_bytes(response.into_body(), usize::MAX).await?;
    let parsed: Value = serde_json::from_slice(&body)?;
    assert_eq!(parsed["code"], "upstream_unavailable");

    Ok(())
}

async fn spawn_mock_vllm() -> Result<std::net::SocketAddr> {
    let router = Router::new().route("/v1/completions", post(handle_mock_completion));
    spawn_router(router).await
}

async fn spawn_failing_vllm() -> Result<std::net::SocketAddr> {
    async fn handler(Json(_): Json<Value>) -> StatusCode {
        StatusCode::INTERNAL_SERVER_ERROR
    }

    let router = Router::new().route("/v1/completions", post(handler));
    spawn_router(router).await
}

async fn spawn_router(router: Router) -> Result<std::net::SocketAddr> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, router).await {
            tracing::error!(%error, "mock vllm server exited unexpectedly");
        }
    });
    Ok(addr)
}

#[derive(Deserialize)]
struct UpstreamRequest {
    model: String,
    prompt: String,
    #[allow(dead_code)]
    max_tokens: Option<u32>,
}

#[derive(Serialize)]
struct UpstreamResponse {
    id: &'static str,
    created: u64,
    model: &'static str,
    choices: Vec<UpstreamChoice>,
    usage: UpstreamUsage,
}

#[derive(Serialize)]
struct UpstreamChoice {
    index: usize,
    text: String,
    #[allow(dead_code)]
    finish_reason: Option<String>,
}

#[derive(Serialize)]
struct UpstreamUsage {
    prompt_tokens: u64,
    completion_tokens: u64,
    total_tokens: u64,
}

async fn handle_mock_completion(Json(request): Json<UpstreamRequest>) -> Json<UpstreamResponse> {
    assert_eq!(request.model, "test-model");
    assert_eq!(request.prompt, "hello tyrum");

    Json(UpstreamResponse {
        id: "mock-1",
        created: 123,
        model: "test-model",
        choices: vec![UpstreamChoice {
            index: 0,
            text: format!("Echo: {}", request.prompt),
            finish_reason: Some("stop".into()),
        }],
        usage: UpstreamUsage {
            prompt_tokens: 3,
            completion_tokens: 2,
            total_tokens: 5,
        },
    })
}
