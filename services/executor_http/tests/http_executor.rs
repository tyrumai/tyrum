#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::net::SocketAddr;

use anyhow::Context;
use axum::{
    Json, Router,
    http::{HeaderName, HeaderValue, StatusCode},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::task::JoinHandle;
use tyrum_executor_http::{HttpActionOutcome, HttpExecutorError, execute_http_action};
use tyrum_shared::planner::{ActionArguments, ActionPrimitive, ActionPrimitiveKind};

#[derive(Deserialize)]
struct EchoPayload {
    message: String,
    count: u32,
}

#[tokio::test(flavor = "multi_thread")]
async fn post_request_with_schema_succeeds() -> anyhow::Result<()> {
    let (addr, server) = start_mock_server().await?;
    let url = format!("http://{addr}/echo");

    let schema = json!({
        "type": "object",
        "required": ["ok", "echo"],
        "properties": {
            "ok": { "type": "boolean" },
            "echo": {
                "type": "object",
                "required": ["message", "count"],
                "properties": {
                    "message": { "type": "string" },
                    "count": { "type": "integer" }
                }
            }
        }
    });

    let primitive = ActionPrimitive::new(
        ActionPrimitiveKind::Http,
        into_args(json!({
            "method": "POST",
            "url": url,
            "headers": {
                "Content-Type": "application/json",
                "Authorization": "Bearer test-token"
            },
            "body": {
                "message": "ping",
                "count": 2
            },
            "response_schema": schema
        })),
    );

    let outcome = execute_http_action(&primitive).await?;

    assert_eq!(outcome.status, StatusCode::OK.as_u16());
    assert_eq!(outcome.body["ok"], json!(true));
    assert_eq!(outcome.body["echo"]["message"], json!("ping"));
    assert_eq!(outcome.body["echo"]["count"], json!(2));
    assert_redacted(&outcome);

    server.abort();
    let _ = server.await;

    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn schema_validation_failure_surfaces_error() -> anyhow::Result<()> {
    let (addr, server) = start_mock_server().await?;
    let url = format!("http://{addr}/echo");

    let primitive = ActionPrimitive::new(
        ActionPrimitiveKind::Http,
        into_args(json!({
            "method": "POST",
            "url": url,
            "body": {
                "message": "ping",
                "count": 2
            },
            "response_schema": {
                "type": "object",
                "required": ["unexpected"],
                "properties": {
                    "unexpected": { "type": "string" }
                }
            }
        })),
    );

    let err = execute_http_action(&primitive)
        .await
        .expect_err("schema validation should fail");

    match err {
        HttpExecutorError::SchemaValidationFailed(message) => {
            assert!(message.contains("unexpected"))
        }
        other => panic!("unexpected error: {:?}", other),
    }

    server.abort();
    let _ = server.await;

    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn non_success_status_returns_failure_context() -> anyhow::Result<()> {
    let (addr, server) = start_mock_server().await?;
    let url = format!("http://{addr}/fail");

    let primitive = ActionPrimitive::new(
        ActionPrimitiveKind::Http,
        into_args(json!({
            "method": "GET",
            "url": url
        })),
    );

    let err = execute_http_action(&primitive)
        .await
        .expect_err("non-success status should fail");

    match err {
        HttpExecutorError::HttpFailure {
            status,
            headers,
            body,
        } => {
            assert_eq!(status, StatusCode::BAD_REQUEST.as_u16());
            assert!(body.get("error").is_some());
            let auth_header = headers
                .iter()
                .find(|header| header.name == "authorization")
                .expect("authorization header present");
            assert_eq!(auth_header.value, "REDACTED");
        }
        other => panic!("unexpected error: {:?}", other),
    }

    server.abort();
    let _ = server.await;

    Ok(())
}
#[tokio::test(flavor = "multi_thread")]
async fn redirects_to_disallowed_host_are_not_followed() -> anyhow::Result<()> {
    let (addr, server) = start_mock_server().await?;
    let url = format!("http://{addr}/redirect");

    let primitive = ActionPrimitive::new(
        ActionPrimitiveKind::Http,
        into_args(json!({
            "method": "GET",
            "url": url
        })),
    );

    let err = execute_http_action(&primitive)
        .await
        .expect_err("redirect to disallowed host should fail");

    match err {
        HttpExecutorError::HttpFailure {
            status, headers, ..
        } => {
            assert_eq!(status, StatusCode::TEMPORARY_REDIRECT.as_u16());
            let location = headers
                .iter()
                .find(|header| header.name == "location")
                .expect("location header present");
            assert_eq!(location.value, "http://example.com/blocked");
        }
        other => panic!("unexpected error: {:?}", other),
    }

    server.abort();
    let _ = server.await;

    Ok(())
}

fn into_args(value: Value) -> ActionArguments {
    value
        .as_object()
        .expect("primitive args must be object")
        .clone()
}

async fn start_mock_server() -> anyhow::Result<(SocketAddr, JoinHandle<()>)> {
    let app = Router::new()
        .route("/echo", post(handle_echo))
        .route("/fail", get(handle_failure))
        .route("/redirect", get(handle_redirect));

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .context("bind fixture listener")?;
    let addr = listener.local_addr().context("read listener address")?;

    let handle = tokio::spawn(async move {
        if let Err(err) = axum::serve(listener, app.into_make_service()).await {
            tracing::warn!(%err, "mock server exited with error");
        }
    });

    Ok((addr, handle))
}

async fn handle_echo(Json(payload): Json<EchoPayload>) -> impl axum::response::IntoResponse {
    let headers = [
        (
            HeaderName::from_static("authorization"),
            HeaderValue::from_static("should-not-leak"),
        ),
        (
            HeaderName::from_static("x-mock"),
            HeaderValue::from_static("echo"),
        ),
    ];

    let body = json!({
        "ok": true,
        "echo": {
            "message": payload.message,
            "count": payload.count
        }
    });

    (headers, Json(body))
}

async fn handle_failure() -> impl axum::response::IntoResponse {
    let headers = [(
        HeaderName::from_static("authorization"),
        HeaderValue::from_static("still-secret"),
    )];
    let body = json!({ "error": "bad request" });
    (StatusCode::BAD_REQUEST, headers, Json(body))
}

async fn handle_redirect() -> impl axum::response::IntoResponse {
    let headers = [(
        HeaderName::from_static("location"),
        HeaderValue::from_static("http://example.com/blocked"),
    )];
    (StatusCode::TEMPORARY_REDIRECT, headers, Json(json!({})))
}

fn assert_redacted(outcome: &HttpActionOutcome) {
    let auth_header = outcome
        .headers
        .iter()
        .find(|header| header.name == "authorization")
        .expect("authorization header present");
    assert_eq!(auth_header.value, "REDACTED");
}
