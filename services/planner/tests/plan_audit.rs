#![allow(clippy::expect_used, clippy::unwrap_used)]

mod common;

use std::sync::Arc;

use axum::{body::Body, http::Request};
use chrono::Utc;
use common::{
    policy::mock_policy,
    postgres::{TestPostgres, docker_available},
    wallet::start_wallet_stub,
};
use http_body_util::BodyExt;
use serde_json::json;
use sqlx::Row;
use tower::ServiceExt;
use tyrum_discovery::DefaultDiscoveryPipeline;
use tyrum_planner::{
    EventLog, PlanOutcome, PlanRequest, PlanResponse, ProfileStore,
    http::{PlannerState, build_router},
};
use tyrum_shared::{
    MessageContent, MessageSource, NormalizedMessage, NormalizedThread, NormalizedThreadMessage,
    PamProfileRef, PiiField, PlanUserContext, SenderMetadata, ThreadKind,
};
use tyrum_wallet::Thresholds;
use uuid::Uuid;

#[tokio::test]
async fn planner_appends_audit_event_with_redacted_payload() {
    if !docker_available() {
        eprintln!("skipping planner_appends_audit_event_with_redacted_payload: docker unavailable");
        return;
    }
    let postgres = TestPostgres::start().await.expect("start postgres fixture");
    let pool = postgres.pool().clone();

    let event_log = EventLog::from_pool(pool.clone());
    event_log.migrate().await.expect("migrate planner schema");

    let (policy_client, policy_server) = mock_policy(json!({
        "decision": "approve",
        "rules": [
            {
                "rule": "spend_limit",
                "outcome": "approve",
                "detail": "No spend requested",
            },
            {
                "rule": "pii_guardrail",
                "outcome": "approve",
                "detail": "PII safe",
            }
        ],
    }))
    .await;

    let (wallet_client, wallet_server) = start_wallet_stub(Thresholds {
        auto_approve_minor_units: 10_000,
        hard_deny_minor_units: 50_000,
    })
    .await;

    let profiles = ProfileStore::new(event_log.pool().clone());

    let state = PlannerState {
        policy_client,
        event_log: event_log.clone(),
        discovery: Arc::new(DefaultDiscoveryPipeline::new()),
        wallet_client,
        profiles,
    };

    let request = sample_request();
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
    let plan: PlanResponse = serde_json::from_slice(&bytes).expect("decode plan response");

    let plan_uuid = plan
        .plan_id
        .strip_prefix("plan-")
        .and_then(|suffix| Uuid::parse_str(suffix).ok())
        .expect("parse plan uuid");

    let rows = sqlx::query("SELECT plan_id, step_index, action FROM planner_events")
        .fetch_all(&pool)
        .await
        .expect("fetch planner events");

    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    let stored_plan: Uuid = row.try_get("plan_id").expect("plan_id");
    let step_index: i32 = row.try_get("step_index").expect("step_index");
    let action: serde_json::Value = row.try_get("action").expect("action payload");

    assert_eq!(stored_plan, plan_uuid);
    assert_eq!(step_index, i32::MAX);

    assert_eq!(
        action.get("plan_id").and_then(|value| value.as_str()),
        Some(plan.plan_id.as_str())
    );
    let recorded_plan_uuid = action
        .get("plan_uuid")
        .and_then(|value| value.as_str())
        .expect("plan_uuid in audit payload");
    assert_eq!(recorded_plan_uuid, plan_uuid.to_string());

    // Ensure audit payload excludes message/thread PII while keeping traceable metadata.
    let request_json = action
        .get("request")
        .and_then(|value| value.as_object())
        .expect("request audit payload");
    let trigger = request_json
        .get("trigger")
        .and_then(|value| value.as_object())
        .expect("trigger audit payload");

    assert_eq!(trigger.get("thread_id").unwrap().as_str(), Some("thread-1"));
    assert_eq!(trigger.get("message_id").unwrap().as_str(), Some("msg-1"));
    assert!(
        trigger
            .get("thread_pii_fields")
            .unwrap()
            .to_string()
            .contains("thread_username")
    );
    assert!(
        trigger
            .get("message_pii_fields")
            .unwrap()
            .to_string()
            .contains("message_text")
    );

    let discovery = action
        .get("discovery")
        .and_then(|value| value.as_object())
        .expect("discovery audit block present");
    assert_eq!(
        discovery.get("status").and_then(|value| value.as_str()),
        Some("not_found"),
        "default pipeline should record not_found discovery"
    );

    let wallet = action
        .get("wallet")
        .and_then(|value| value.as_object())
        .expect("wallet audit block present");
    assert_eq!(
        wallet.get("status").and_then(|value| value.as_str()),
        Some("skipped"),
        "wallet audit should be skipped when no spend directive is present"
    );

    let payload_text = action.to_string();
    assert!(!payload_text.contains("alex"));
    assert!(!payload_text.contains("Plan espresso tasting"));

    match plan.outcome {
        PlanOutcome::Success { .. } => {}
        other => panic!("expected success outcome, got {other:?}"),
    }
}

fn sample_request() -> PlanRequest {
    PlanRequest {
        request_id: "req-123".into(),
        subject_id: "subject-456".into(),
        user: Some(PlanUserContext {
            user_id: "subject-456".into(),
            pam_profile: Some(PamProfileRef {
                profile_id: "pam-default".into(),
                version: Some("v1".into()),
            }),
        }),
        trigger: NormalizedThreadMessage {
            thread: NormalizedThread {
                id: "thread-1".into(),
                kind: ThreadKind::Private,
                title: None,
                username: Some("alex".into()),
                pii_fields: vec![PiiField::ThreadUsername],
            },
            message: NormalizedMessage {
                id: "msg-1".into(),
                thread_id: "thread-1".into(),
                source: MessageSource::Telegram,
                content: MessageContent::Text {
                    text: "Plan espresso tasting".into(),
                },
                sender: Some(SenderMetadata {
                    id: "sender-9".into(),
                    is_bot: false,
                    first_name: Some("Alex".into()),
                    last_name: None,
                    username: Some("alex".into()),
                    language_code: Some("en".into()),
                }),
                timestamp: Utc::now(),
                edited_timestamp: None,
                pii_fields: vec![PiiField::MessageText],
            },
        },
        locale: Some("en-US".into()),
        timezone: Some("America/Los_Angeles".into()),
        tags: vec!["telegram".into()],
    }
}
