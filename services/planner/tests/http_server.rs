use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use chrono::Utc;
use http_body_util::BodyExt;
use tower::ServiceExt;
use tyrum_planner::{
    PlanOutcome, PlanRequest, PlanResponse,
    http::{MAX_PLAN_REQUEST_BYTES, build_router},
};
use tyrum_shared::{
    MessageContent, MessageSource, NormalizedMessage, NormalizedThread, NormalizedThreadMessage,
    PiiField, SenderMetadata, ThreadKind,
};

fn sample_request() -> PlanRequest {
    PlanRequest {
        request_id: "req-123".into(),
        subject_id: "subject-456".into(),
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

#[tokio::test]
async fn plan_returns_stub_response() {
    let payload = sample_request();
    let body = serde_json::to_vec(&payload).expect("serialize plan request");

    let response = build_router()
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

    assert_eq!(response.status(), StatusCode::OK);

    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let plan: PlanResponse = serde_json::from_slice(&bytes).expect("decode plan response");

    assert!(plan.plan_id.starts_with("plan-"));
    assert_eq!(plan.request_id, payload.request_id);
    match plan.outcome {
        PlanOutcome::Success { steps, summary } => {
            assert!(steps.len() >= 2);
            assert!(summary.synopsis.is_some());
        }
        outcome => panic!("expected success outcome, got {:?}", outcome),
    }
}

#[tokio::test]
async fn plan_rejects_oversized_payloads() {
    let mut payload = sample_request();
    payload.tags = vec![
        String::from_utf8(vec![b'x'; MAX_PLAN_REQUEST_BYTES + 1]).expect("build oversized tag"),
    ];

    let body = serde_json::to_vec(&payload).expect("serialize oversized request");

    let response = build_router()
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

    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
}
