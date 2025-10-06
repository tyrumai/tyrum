mod common;

use axum::{body::Body, http::Request};
use chrono::Utc;
use common::{policy::mock_policy, postgres::TestPostgres};
use http_body_util::BodyExt;
use serde_json::json;
use sqlx::Row;
use tower::ServiceExt;
use tyrum_planner::{
    EventLog, PlanErrorCode, PlanOutcome, PlanRequest, PlanResponse,
    http::{PlannerState, build_router},
};
use tyrum_shared::{
    MessageContent, MessageSource, NormalizedMessage, NormalizedThread, NormalizedThreadMessage,
    PiiField, SenderMetadata, ThreadKind,
};
use uuid::Uuid;

#[tokio::test]
async fn policy_denial_is_logged_and_sanitized() {
    let postgres = TestPostgres::start().await.expect("start postgres fixture");
    let pool = postgres.pool().clone();

    let event_log = EventLog::from_pool(pool.clone());
    event_log.migrate().await.expect("migrate planner schema");

    let denial_detail = "Amount €123.45 exceeds hard limit €500.00.";
    let (policy_client, server) = mock_policy(json!({
        "decision": "deny",
        "rules": [
            {
                "rule": "spend_limit",
                "outcome": "deny",
                "detail": denial_detail,
            }
        ],
    }))
    .await;

    let state = PlannerState {
        policy_client,
        event_log: event_log.clone(),
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

    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let plan: PlanResponse = serde_json::from_slice(&bytes).expect("decode plan response");
    server.abort();

    let failure = match plan.outcome {
        PlanOutcome::Failure { error } => {
            assert_eq!(error.code, PlanErrorCode::PolicyDenied);
            assert!(!error.retryable, "policy denials should not be retryable");
            let detail = error.detail.expect("denial reason present");
            assert!(
                detail.contains("SpendLimit"),
                "detail should reference the triggering rule"
            );
            assert!(
                !detail.chars().any(|character| character.is_ascii_digit()),
                "detail should be sanitized: {detail}"
            );
            detail
        }
        other => panic!("expected policy failure outcome, got {other:?}"),
    };

    let plan_uuid = plan
        .plan_id
        .strip_prefix("plan-")
        .and_then(|suffix| Uuid::parse_str(suffix).ok())
        .expect("parse plan uuid");

    let rows = sqlx::query("SELECT plan_id, step_index, action FROM planner_events")
        .fetch_all(&pool)
        .await
        .expect("fetch planner events");

    assert_eq!(rows.len(), 1, "expected a single audit event");
    let row = &rows[0];
    let stored_plan: Uuid = row.try_get("plan_id").expect("plan_id");
    let step_index: i32 = row.try_get("step_index").expect("step_index");
    assert_eq!(stored_plan, plan_uuid);
    assert_eq!(step_index, i32::MAX);

    let action: serde_json::Value = row.try_get("action").expect("action payload");

    let policy = action
        .get("policy")
        .and_then(|value| value.as_object())
        .expect("policy audit block present");
    assert_eq!(
        policy.get("status").and_then(|value| value.as_str()),
        Some("evaluated")
    );
    assert_eq!(
        policy.get("decision").and_then(|value| value.as_str()),
        Some("Deny")
    );

    let rules = policy
        .get("rules")
        .and_then(|value| value.as_array())
        .expect("policy rule audit present");
    assert_eq!(rules.len(), 1);
    let rule_detail = rules[0]
        .get("detail")
        .and_then(|value| value.as_str())
        .expect("rule detail recorded");
    assert!(rule_detail.contains("Amount"));
    assert!(
        !rule_detail
            .chars()
            .any(|character| character.is_ascii_digit()),
        "rule detail should be sanitized: {rule_detail}"
    );

    let outcome = action
        .get("outcome")
        .and_then(|value| value.as_object())
        .expect("outcome audit block present");
    assert_eq!(
        outcome.get("status").and_then(|value| value.as_str()),
        Some("failure")
    );
    let audit_detail = outcome
        .get("detail")
        .and_then(|value| value.as_str())
        .expect("failure reason stored");
    assert_eq!(audit_detail, failure);
    assert!(
        !audit_detail
            .chars()
            .any(|character| character.is_ascii_digit()),
        "audit reason should be sanitized: {audit_detail}"
    );
}

fn sample_request() -> PlanRequest {
    PlanRequest {
        request_id: "req-321".into(),
        subject_id: "subject-999".into(),
        trigger: NormalizedThreadMessage {
            thread: NormalizedThread {
                id: "thread-2".into(),
                kind: ThreadKind::Private,
                title: None,
                username: Some("harper".into()),
                pii_fields: vec![PiiField::ThreadUsername],
            },
            message: NormalizedMessage {
                id: "msg-2".into(),
                thread_id: "thread-2".into(),
                source: MessageSource::Telegram,
                content: MessageContent::Text {
                    text: "Book a tasting menu".into(),
                },
                sender: Some(SenderMetadata {
                    id: "sender-10".into(),
                    is_bot: false,
                    first_name: Some("Harper".into()),
                    last_name: None,
                    username: Some("harper".into()),
                    language_code: Some("en".into()),
                }),
                timestamp: Utc::now(),
                edited_timestamp: None,
                pii_fields: vec![PiiField::MessageText],
            },
        },
        locale: Some("en-US".into()),
        timezone: Some("Europe/Amsterdam".into()),
        tags: vec!["telegram".into()],
    }
}
