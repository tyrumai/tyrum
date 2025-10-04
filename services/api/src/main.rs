use std::{env, net::SocketAddr};

use axum::{Json, Router, routing::get};
use serde::Serialize;
use telemetry::TelemetryGuard;

mod metrics;
mod telemetry;

const DEFAULT_BIND_ADDR: &str = "0.0.0.0:8080";

#[derive(Clone, Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Clone, Serialize)]
struct WelcomeResponse {
    message: &'static str,
}

fn build_router() -> Router {
    Router::new()
        .route("/", get(index))
        .route("/healthz", get(health))
}

#[tracing::instrument(name = "api.index", skip_all)]
async fn index() -> Json<WelcomeResponse> {
    metrics::record_http_request("GET", "/", 200);
    Json(WelcomeResponse {
        message: "Tyrum API skeleton is running",
    })
}

#[tracing::instrument(name = "api.health", skip_all)]
async fn health() -> Json<HealthResponse> {
    metrics::record_http_request("GET", "/healthz", 200);
    Json(HealthResponse { status: "ok" })
}

#[tokio::main]
async fn main() {
    let _telemetry = TelemetryGuard::install("tyrum-api").expect("failed to initialize telemetry");

    let bind_addr: SocketAddr = env::var("API_BIND_ADDR")
        .unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string())
        .parse()
        .expect("invalid API_BIND_ADDR");

    let app = build_router();

    tracing::info!("listening on {}", bind_addr);
    axum::serve(tokio::net::TcpListener::bind(bind_addr).await.unwrap(), app)
        .await
        .expect("server exited unexpectedly");
}

#[cfg(test)]
mod tests {
    use super::build_router;
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use serde_json::json;
    use tower::ServiceExt;

    #[tokio::test]
    async fn health_endpoint_returns_ok() {
        let app = build_router();
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let value: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(value, json!({"status": "ok" }));
    }
}
