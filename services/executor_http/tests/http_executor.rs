#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::{
    net::SocketAddr,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use anyhow::Context;
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderName, HeaderValue, StatusCode},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::task::JoinHandle;
use tyrum_executor_http::{
    HttpActionOutcome, HttpExecutorError, HttpRetryOutcome, execute_http_action,
};
use tyrum_shared::planner::{ActionArguments, ActionPrimitive, ActionPrimitiveKind};
use tyrum_shared::{AssertionFailureCode, AssertionOutcome};

#[derive(Deserialize)]
struct EchoPayload {
    message: String,
    count: u32,
}

#[derive(Clone)]
struct FixtureState {
    flaky_attempts: Arc<AtomicUsize>,
    failure_attempts: Arc<AtomicUsize>,
}

impl FixtureState {
    fn new() -> Self {
        Self {
            flaky_attempts: Arc::new(AtomicUsize::new(0)),
            failure_attempts: Arc::new(AtomicUsize::new(0)),
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn post_request_with_schema_succeeds() -> anyhow::Result<()> {
    let (addr, server, _) = start_mock_server().await?;
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
    assert!(outcome.postcondition.is_none());
    assert_redacted(&outcome);

    server.abort();
    let _ = server.await;

    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn postcondition_success_returns_report() -> anyhow::Result<()> {
    let (addr, server, _) = start_mock_server().await?;
    let url = format!("http://{addr}/echo");

    let primitive = ActionPrimitive::new(
        ActionPrimitiveKind::Http,
        into_args(json!({
            "method": "POST",
            "url": url,
            "body": {
                "message": "ping",
                "count": 2
            }
        })),
    )
    .with_postcondition(json!({
        "assertions": [
            { "type": "http_status", "equals": 200 },
            { "type": "json_path", "path": "$.echo.message", "equals": "ping" }
        ]
    }));

    let outcome = execute_http_action(&primitive).await?;
    let report = outcome.postcondition.expect("postcondition report present");
    assert!(report.passed);
    assert_eq!(report.assertions.len(), 2);
    assert!(
        report
            .assertions
            .iter()
            .all(|item| matches!(item.outcome, AssertionOutcome::Passed { .. }))
    );

    server.abort();
    let _ = server.await;

    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn postcondition_failure_surfaces_report() -> anyhow::Result<()> {
    let (addr, server, _) = start_mock_server().await?;
    let url = format!("http://{addr}/echo");

    let primitive = ActionPrimitive::new(
        ActionPrimitiveKind::Http,
        into_args(json!({
            "method": "POST",
            "url": url,
            "body": {
                "message": "ping",
                "count": 2
            }
        })),
    )
    .with_postcondition(json!({
        "assertions": [
            { "type": "http_status", "equals": 200 },
            { "type": "json_path", "path": "$.echo.count", "equals": 99 }
        ]
    }));

    let err = execute_http_action(&primitive)
        .await
        .expect_err("postcondition mismatch should fail");

    match err {
        HttpExecutorError::PostconditionFailed { report } => {
            assert!(!report.passed);
            let failing = report
                .assertions
                .iter()
                .find_map(|item| match &item.outcome {
                    AssertionOutcome::Failed { code, .. } => Some(code),
                    AssertionOutcome::Passed { .. } => None,
                })
                .expect("failing assertion present");
            assert_eq!(*failing, AssertionFailureCode::JsonPathPredicateFailed);
        }
        other => panic!("unexpected error variant: {:?}", other),
    }

    server.abort();
    let _ = server.await;

    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn unsupported_postcondition_returns_error() -> anyhow::Result<()> {
    let (addr, server, _) = start_mock_server().await?;
    let url = format!("http://{addr}/echo");

    let primitive = ActionPrimitive::new(
        ActionPrimitiveKind::Http,
        into_args(json!({
            "method": "POST",
            "url": url,
            "body": {
                "message": "ping",
                "count": 2
            }
        })),
    )
    .with_postcondition(json!({
        "type": "legacy_status",
        "value": "done"
    }));

    let err = execute_http_action(&primitive)
        .await
        .expect_err("unsupported postcondition should fail");

    match err {
        HttpExecutorError::UnsupportedPostcondition { type_name } => {
            assert_eq!(type_name, "legacy_status");
        }
        other => panic!("unexpected error variant: {:?}", other),
    }

    server.abort();
    let _ = server.await;

    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn schema_validation_failure_surfaces_error() -> anyhow::Result<()> {
    let (addr, server, _) = start_mock_server().await?;
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
    let (addr, server, _) = start_mock_server().await?;
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
    let (addr, server, _) = start_mock_server().await?;
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

#[tokio::test(flavor = "multi_thread")]
async fn retry_transient_status_eventually_succeeds() -> anyhow::Result<()> {
    let (addr, server, state) = start_mock_server().await?;
    let url = format!("http://{addr}/flaky");

    let primitive = ActionPrimitive::new(
        ActionPrimitiveKind::Http,
        into_args(json!({
            "method": "GET",
            "url": url
        })),
    );

    let outcome = execute_http_action(&primitive).await?;
    assert_eq!(outcome.status, StatusCode::OK.as_u16());
    assert_eq!(outcome.body["ok"], json!(true));

    assert_eq!(state.flaky_attempts.load(Ordering::SeqCst), 2);

    server.abort();
    let _ = server.await;

    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn retry_exhaustion_reports_history() -> anyhow::Result<()> {
    let (addr, server, _) = start_mock_server().await?;
    let url = format!("http://{addr}/unstable");

    let primitive = ActionPrimitive::new(
        ActionPrimitiveKind::Http,
        into_args(json!({
            "method": "GET",
            "url": url
        })),
    );

    let err = execute_http_action(&primitive)
        .await
        .expect_err("persistent failures should exhaust retries");

    match err {
        HttpExecutorError::RetriesExhausted {
            attempts,
            history,
            last_error,
        } => {
            assert!(attempts >= 3);
            assert_eq!(history.len() as u32, attempts);
            assert!(history.iter().all(|record| matches!(record.outcome, HttpRetryOutcome::Status(code) if code == StatusCode::SERVICE_UNAVAILABLE.as_u16())));
            match *last_error {
                HttpExecutorError::HttpFailure { status, .. } => {
                    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE.as_u16());
                }
                other => panic!("unexpected last error variant: {:?}", other),
            }
        }
        other => panic!("unexpected error variant: {:?}", other),
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

async fn start_mock_server() -> anyhow::Result<(SocketAddr, JoinHandle<()>, FixtureState)> {
    let state = FixtureState::new();
    let app = Router::new()
        .route("/echo", post(handle_echo))
        .route("/fail", get(handle_failure))
        .route("/redirect", get(handle_redirect))
        .route("/flaky", get(handle_flaky))
        .route("/unstable", get(handle_persistent_failure))
        .with_state(state.clone());

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .context("bind fixture listener")?;
    let addr = listener.local_addr().context("read listener address")?;

    let handle = tokio::spawn(async move {
        if let Err(err) = axum::serve(listener, app.into_make_service()).await {
            tracing::warn!(%err, "mock server exited with error");
        }
    });

    Ok((addr, handle, state))
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

async fn handle_flaky(State(state): State<FixtureState>) -> impl axum::response::IntoResponse {
    let attempt = state.flaky_attempts.fetch_add(1, Ordering::SeqCst);
    if attempt == 0 {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "ok": false,
                "attempt": attempt + 1
            })),
        )
    } else {
        (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "attempt": attempt + 1
            })),
        )
    }
}

async fn handle_persistent_failure(
    State(state): State<FixtureState>,
) -> impl axum::response::IntoResponse {
    let attempt = state.failure_attempts.fetch_add(1, Ordering::SeqCst);
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({
            "ok": false,
            "attempt": attempt + 1
        })),
    )
}

fn assert_redacted(outcome: &HttpActionOutcome) {
    let auth_header = outcome
        .headers
        .iter()
        .find(|header| header.name == "authorization")
        .expect("authorization header present");
    assert_eq!(auth_header.value, "REDACTED");
}
