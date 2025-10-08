#![allow(clippy::expect_used, clippy::unwrap_used)]

mod common;

use std::sync::Arc;

use axum::{body::Body, http::Request};
use chrono::Utc;
use http_body_util::BodyExt;
use serde_json::json;
use sqlx::Row;
use tower::ServiceExt;
use tyrum_discovery::DefaultDiscoveryPipeline;
use tyrum_planner::{
    ActionPrimitiveKind, EventLog, PlanOutcome, PlanRequest,
    http::{PlannerState, build_router},
};
use tyrum_shared::{
    MessageContent, MessageSource, NormalizedMessage, NormalizedThread, NormalizedThreadMessage,
    PiiField, SenderMetadata, ThreadKind,
};
use tyrum_wallet::Thresholds;

use common::{policy::mock_policy, postgres::TestPostgres, wallet::start_wallet_stub};

fn spend_request(amount_minor_units: u64) -> PlanRequest {
    PlanRequest {
        request_id: format!("req-{amount_minor_units}"),
        subject_id: "subject-wallet".into(),
        trigger: NormalizedThreadMessage {
            thread: NormalizedThread {
                id: "thread-wallet".into(),
                kind: ThreadKind::Private,
                title: None,
                username: Some("wallet_user".into()),
                pii_fields: vec![PiiField::ThreadUsername],
            },
            message: NormalizedMessage {
                id: "msg-wallet".into(),
                thread_id: "thread-wallet".into(),
                source: MessageSource::Telegram,
                content: MessageContent::Text {
                    text: "Book tasting and settle deposit".into(),
                },
                sender: Some(SenderMetadata {
                    id: "sender-wallet".into(),
                    is_bot: false,
                    first_name: Some("Jamie".into()),
                    last_name: None,
                    username: Some("wallet_user".into()),
                    language_code: Some("en".into()),
                }),
                timestamp: Utc::now(),
                edited_timestamp: None,
                pii_fields: vec![PiiField::MessageText],
            },
        },
        locale: Some("en-US".into()),
        timezone: Some("Europe/Amsterdam".into()),
        tags: vec![format!("spend:{amount_minor_units}:EUR:espresso_bar")],
    }
}

fn policy_approve_payload() -> serde_json::Value {
    json!({
        "decision": "approve",
        "rules": [
            {
                "rule": "spend_limit",
                "outcome": "approve",
                "detail": "Spend within policy",
            },
            {
                "rule": "pii_guardrail",
                "outcome": "approve",
                "detail": "PII safe",
            },
            {
                "rule": "legal_compliance",
                "outcome": "approve",
                "detail": "No legal concerns",
            }
        ],
    })
}

fn wallet_thresholds() -> Thresholds {
    Thresholds {
        auto_approve_minor_units: 10_000,
        hard_deny_minor_units: 50_000,
    }
}

async fn planner_state() -> (
    PlannerState,
    tokio::task::JoinHandle<()>,
    tokio::task::JoinHandle<()>,
    TestPostgres,
) {
    let (policy_client, policy_server) = mock_policy(policy_approve_payload()).await;
    let (wallet_client, wallet_server) = start_wallet_stub(wallet_thresholds()).await;
    let postgres = TestPostgres::start().await.expect("start postgres fixture");
    let event_log = EventLog::from_pool(postgres.pool().clone());
    event_log.migrate().await.expect("migrate planner schema");

    let state = PlannerState {
        policy_client,
        event_log,
        discovery: Arc::new(DefaultDiscoveryPipeline::new()),
        wallet_client,
    };

    (state, policy_server, wallet_server, postgres)
}

#[tokio::test]
async fn wallet_authorization_approve_returns_success() {
    let (state, policy_server, wallet_server, postgres) = planner_state().await;

    let request = spend_request(7_500);
    let body = serde_json::to_vec(&request).expect("serialize plan request");

    let response = build_router(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/plan")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .expect("construct request"),
        )
        .await
        .expect("receive response");

    policy_server.abort();
    wallet_server.abort();

    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let plan: tyrum_planner::PlanResponse = serde_json::from_slice(&bytes).expect("decode plan");

    let steps = match plan.outcome {
        PlanOutcome::Success { steps, .. } => steps,
        other => panic!("expected success, got {other:?}"),
    };

    assert_eq!(steps.len(), 4, "research, fallback, pay, follow-up");
    assert_eq!(steps[2].kind, ActionPrimitiveKind::Pay);

    let row = sqlx::query("SELECT action FROM planner_events")
        .fetch_one(postgres.pool())
        .await
        .expect("fetch planner audit");
    let action: serde_json::Value = row.try_get("action").expect("action payload");
    let wallet = action
        .get("wallet")
        .and_then(|value| value.as_object())
        .expect("wallet audit block");
    assert_eq!(
        wallet.get("status").and_then(|value| value.as_str()),
        Some("evaluated")
    );
    assert_eq!(
        wallet.get("decision").and_then(|value| value.as_str()),
        Some("Approve")
    );
    let reason = wallet
        .get("reason")
        .and_then(|value| value.as_str())
        .expect("wallet reason");
    assert!(
        !reason.chars().any(|character| character.is_ascii_digit()),
        "wallet reason should be sanitized: {reason}"
    );
}

#[tokio::test]
async fn wallet_authorization_escalates_plan() {
    let (state, policy_server, wallet_server, postgres) = planner_state().await;

    let request = spend_request(20_000);
    let body = serde_json::to_vec(&request).expect("serialize plan request");

    let response = build_router(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/plan")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .expect("construct request"),
        )
        .await
        .expect("receive response");

    policy_server.abort();
    wallet_server.abort();

    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let plan: tyrum_planner::PlanResponse = serde_json::from_slice(&bytes).expect("decode plan");

    let escalation = match plan.outcome {
        PlanOutcome::Escalate { escalation } => escalation,
        other => panic!("expected escalate outcome, got {other:?}"),
    };

    let rationale = escalation.rationale.expect("rationale present");
    assert!(
        !rationale
            .chars()
            .any(|character| character.is_ascii_digit()),
        "escalation rationale should be sanitized: {rationale}"
    );

    let row = sqlx::query("SELECT action FROM planner_events")
        .fetch_one(postgres.pool())
        .await
        .expect("fetch planner audit");
    let action: serde_json::Value = row.try_get("action").expect("action payload");
    let wallet = action
        .get("wallet")
        .and_then(|value| value.as_object())
        .expect("wallet audit block");
    assert_eq!(
        wallet.get("status").and_then(|value| value.as_str()),
        Some("evaluated")
    );
    assert_eq!(
        wallet.get("decision").and_then(|value| value.as_str()),
        Some("Escalate")
    );
    let reason = wallet
        .get("reason")
        .and_then(|value| value.as_str())
        .expect("wallet reason");
    assert!(
        !reason.chars().any(|character| character.is_ascii_digit()),
        "wallet reason should be sanitized: {reason}"
    );
}

#[tokio::test]
async fn wallet_authorization_denies_plan() {
    let (state, policy_server, wallet_server, postgres) = planner_state().await;

    let request = spend_request(60_000);
    let body = serde_json::to_vec(&request).expect("serialize plan request");

    let response = build_router(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/plan")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .expect("construct request"),
        )
        .await
        .expect("receive response");

    policy_server.abort();
    wallet_server.abort();

    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let plan: tyrum_planner::PlanResponse = serde_json::from_slice(&bytes).expect("decode plan");

    let error = match plan.outcome {
        PlanOutcome::Failure { error } => error,
        other => panic!("expected failure outcome, got {other:?}"),
    };

    let detail = error.detail.expect("denial reason present");
    assert!(
        !detail.chars().any(|character| character.is_ascii_digit()),
        "denial detail should be sanitized: {detail}"
    );

    let row = sqlx::query("SELECT action FROM planner_events")
        .fetch_one(postgres.pool())
        .await
        .expect("fetch planner audit");
    let action: serde_json::Value = row.try_get("action").expect("action payload");
    let wallet = action
        .get("wallet")
        .and_then(|value| value.as_object())
        .expect("wallet audit block");
    assert_eq!(
        wallet.get("status").and_then(|value| value.as_str()),
        Some("evaluated")
    );
    assert_eq!(
        wallet.get("decision").and_then(|value| value.as_str()),
        Some("Deny")
    );
    let reason = wallet
        .get("reason")
        .and_then(|value| value.as_str())
        .expect("wallet reason");
    assert!(
        !reason.chars().any(|character| character.is_ascii_digit()),
        "wallet reason should be sanitized: {reason}"
    );
}
