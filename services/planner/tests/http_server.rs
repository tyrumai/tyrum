mod common;

use std::sync::{Arc, Mutex};

use axum::{
    Json, Router,
    body::Body,
    http::{Request, StatusCode},
    routing::post,
};
use chrono::Utc;
use common::postgres::TestPostgres;
use common::wallet::start_wallet_stub;
use http_body_util::BodyExt;
use reqwest::Url;
use tokio::{net::TcpListener, task::JoinHandle};
use tower::ServiceExt;
use tyrum_discovery::{
    DefaultDiscoveryPipeline, DiscoveryConnector, DiscoveryOutcome, DiscoveryPipeline,
    DiscoveryRequest, DiscoveryStrategy,
};
use tyrum_planner::{
    ActionPrimitiveKind, EventLog, PlanOutcome, PlanRequest, PlanResponse,
    http::{MAX_PLAN_REQUEST_BYTES, PlannerState, build_router},
    policy::PolicyClient,
};
use tyrum_shared::{
    MessageContent, MessageSource, NormalizedMessage, NormalizedThread, NormalizedThreadMessage,
    PiiField, SenderMetadata, ThreadKind,
};
use tyrum_wallet::Thresholds;

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

fn approving_policy_payload() -> serde_json::Value {
    serde_json::json!({
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
            },
            {
                "rule": "legal_compliance",
                "outcome": "approve",
                "detail": "No legal flags",
            },
        ],
    })
}

fn found_connector(strategy: DiscoveryStrategy, locator: &str) -> DiscoveryOutcome {
    DiscoveryOutcome::Found(DiscoveryConnector {
        strategy,
        locator: locator.to_string(),
    })
}

struct MockDiscoveryPipeline {
    calls: Mutex<Vec<DiscoveryStrategy>>,
    mcp: DiscoveryOutcome,
    structured: DiscoveryOutcome,
    generic: DiscoveryOutcome,
}

impl MockDiscoveryPipeline {
    fn new(mcp: DiscoveryOutcome, structured: DiscoveryOutcome, generic: DiscoveryOutcome) -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            mcp,
            structured,
            generic,
        }
    }

    fn record(&self, strategy: DiscoveryStrategy) {
        let mut guard = self.calls.lock().expect("record discovery call");
        guard.push(strategy);
    }

    fn calls(&self) -> Vec<DiscoveryStrategy> {
        self.calls.lock().expect("read discovery calls").clone()
    }
}

impl DiscoveryPipeline for MockDiscoveryPipeline {
    fn try_mcp(&self, request: &DiscoveryRequest) -> DiscoveryOutcome {
        assert!(
            !request.sanitized_subject().is_empty(),
            "subject should be sanitized"
        );
        self.record(DiscoveryStrategy::Mcp);
        self.mcp.clone()
    }

    fn try_structured_api(&self, request: &DiscoveryRequest) -> DiscoveryOutcome {
        assert!(
            !request.sanitized_subject().is_empty(),
            "subject should be sanitized"
        );
        self.record(DiscoveryStrategy::StructuredApi);
        self.structured.clone()
    }

    fn try_generic_http(&self, request: &DiscoveryRequest) -> DiscoveryOutcome {
        assert!(
            !request.sanitized_subject().is_empty(),
            "subject should be sanitized"
        );
        self.record(DiscoveryStrategy::GenericHttp);
        self.generic.clone()
    }
}

#[tokio::test]
async fn plan_returns_stub_response() {
    let payload = sample_request();
    let body = serde_json::to_vec(&payload).expect("serialize plan request");

    let (state, policy_server, wallet_server, _postgres) =
        planner_state(approving_policy_payload()).await;

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

    assert_eq!(response.status(), StatusCode::OK);

    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let plan: PlanResponse = serde_json::from_slice(&bytes).expect("decode plan response");

    assert!(plan.plan_id.starts_with("plan-"));
    assert_eq!(plan.request_id, payload.request_id);
    match plan.outcome {
        PlanOutcome::Success { steps, summary } => {
            assert_eq!(
                steps.len(),
                3,
                "planner should emit research, executor, follow-up steps"
            );

            let executor_step = &steps[1];
            assert_eq!(executor_step.kind, ActionPrimitiveKind::Web);
            assert_eq!(
                executor_step
                    .args
                    .get("executor")
                    .and_then(|value| value.as_str()),
                Some("generic-web"),
                "fallback should target generic web executor"
            );

            let synopsis = summary.synopsis.expect("summary present");
            assert!(synopsis.contains("Falling back to automation"));
        }
        outcome => panic!("expected success outcome, got {:?}", outcome),
    }
}

#[tokio::test]
async fn discovery_pipeline_uses_mcp_capability() {
    let pipeline = Arc::new(MockDiscoveryPipeline::new(
        found_connector(DiscoveryStrategy::Mcp, "mcp://capability"),
        DiscoveryOutcome::NotFound,
        DiscoveryOutcome::NotFound,
    ));
    let pipeline_trait: Arc<dyn DiscoveryPipeline + Send + Sync> = pipeline.clone();

    let payload = sample_request();
    let body = serde_json::to_vec(&payload).expect("serialize plan request");

    let (state, policy_server, wallet_server, _postgres) =
        planner_state_with_pipeline(approving_policy_payload(), pipeline_trait).await;

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

    let (steps, summary) = match plan.outcome {
        PlanOutcome::Success { steps, summary } => (steps, summary),
        other => panic!("expected success, got {other:?}"),
    };

    assert_eq!(steps[1].kind, ActionPrimitiveKind::Http);
    assert_eq!(
        steps[1]
            .args
            .get("executor")
            .and_then(|value| value.as_str()),
        Some("discovered-mcp")
    );
    assert_eq!(
        steps[1]
            .args
            .get("locator")
            .and_then(|value| value.as_str()),
        Some("mcp://capability")
    );
    assert!(
        summary
            .synopsis
            .as_ref()
            .is_some_and(|text| text.contains("Discovered mcp capability"))
    );

    assert_eq!(pipeline.calls(), vec![DiscoveryStrategy::Mcp]);
}

#[tokio::test]
async fn discovery_pipeline_uses_structured_api_capability() {
    let pipeline = Arc::new(MockDiscoveryPipeline::new(
        DiscoveryOutcome::NotFound,
        found_connector(DiscoveryStrategy::StructuredApi, "https://api.example.com"),
        DiscoveryOutcome::NotFound,
    ));
    let pipeline_trait: Arc<dyn DiscoveryPipeline + Send + Sync> = pipeline.clone();

    let payload = sample_request();
    let body = serde_json::to_vec(&payload).expect("serialize plan request");

    let (state, policy_server, wallet_server, _postgres) =
        planner_state_with_pipeline(approving_policy_payload(), pipeline_trait).await;

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

    let (steps, summary) = match plan.outcome {
        PlanOutcome::Success { steps, summary } => (steps, summary),
        other => panic!("expected success, got {other:?}"),
    };

    assert_eq!(steps[1].kind, ActionPrimitiveKind::Http);
    assert_eq!(
        steps[1]
            .args
            .get("executor")
            .and_then(|value| value.as_str()),
        Some("discovered-structured")
    );
    assert_eq!(
        pipeline.calls(),
        vec![DiscoveryStrategy::Mcp, DiscoveryStrategy::StructuredApi]
    );
    assert!(
        summary
            .synopsis
            .as_ref()
            .is_some_and(|text| text.contains("Discovered structured_api capability"))
    );
}

#[tokio::test]
async fn discovery_pipeline_uses_generic_http_capability() {
    let pipeline = Arc::new(MockDiscoveryPipeline::new(
        DiscoveryOutcome::NotFound,
        DiscoveryOutcome::NotFound,
        found_connector(
            DiscoveryStrategy::GenericHttp,
            "https://fallback.example.com",
        ),
    ));
    let pipeline_trait: Arc<dyn DiscoveryPipeline + Send + Sync> = pipeline.clone();

    let payload = sample_request();
    let body = serde_json::to_vec(&payload).expect("serialize plan request");

    let (state, policy_server, wallet_server, _postgres) =
        planner_state_with_pipeline(approving_policy_payload(), pipeline_trait).await;

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

    let (steps, summary) = match plan.outcome {
        PlanOutcome::Success { steps, summary } => (steps, summary),
        other => panic!("expected success, got {other:?}"),
    };

    assert_eq!(steps[1].kind, ActionPrimitiveKind::Http);
    assert_eq!(
        steps[1]
            .args
            .get("executor")
            .and_then(|value| value.as_str()),
        Some("generic-http")
    );
    assert_eq!(
        pipeline.calls(),
        vec![
            DiscoveryStrategy::Mcp,
            DiscoveryStrategy::StructuredApi,
            DiscoveryStrategy::GenericHttp,
        ]
    );
    assert!(
        summary
            .synopsis
            .as_ref()
            .is_some_and(|text| text.contains("Discovered generic_http capability"))
    );
}

#[tokio::test]
async fn plan_rejects_oversized_payloads() {
    let mut payload = sample_request();
    payload.tags = vec![
        String::from_utf8(vec![b'x'; MAX_PLAN_REQUEST_BYTES + 1]).expect("build oversized tag"),
    ];

    let body = serde_json::to_vec(&payload).expect("serialize oversized request");

    let (state, policy_server, wallet_server, _postgres) = planner_state(serde_json::json!({
        "decision": "approve",
        "rules": [],
    }))
    .await;

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

    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn plan_escalates_on_policy_escalation() {
    let payload = sample_request();
    let body = serde_json::to_vec(&payload).expect("serialize plan request");

    let (state, policy_server, wallet_server, _postgres) = planner_state(serde_json::json!({
        "decision": "escalate",
        "rules": [
            {
                "rule": "spend_limit",
                "outcome": "escalate",
                "detail": "No spend context provided",
            }
        ],
    }))
    .await;

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

    assert_eq!(response.status(), StatusCode::OK);

    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let plan: PlanResponse = serde_json::from_slice(&bytes).expect("decode plan response");

    match plan.outcome {
        PlanOutcome::Escalate { escalation } => {
            assert_eq!(escalation.step_index, 0);
        }
        outcome => panic!("expected escalation, got {:?}", outcome),
    }
}

#[tokio::test]
async fn plan_returns_failure_on_policy_denial() {
    let payload = sample_request();
    let body = serde_json::to_vec(&payload).expect("serialize plan request");

    let (state, policy_server, wallet_server, _postgres) = planner_state(serde_json::json!({
        "decision": "deny",
        "rules": [
            {
                "rule": "pii_guardrail",
                "outcome": "deny",
                "detail": "PII classified as biometric",
            }
        ],
    }))
    .await;

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

    assert_eq!(response.status(), StatusCode::OK);

    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let plan: PlanResponse = serde_json::from_slice(&bytes).expect("decode plan response");

    match plan.outcome {
        PlanOutcome::Failure { error } => {
            assert_eq!(error.code, tyrum_planner::PlanErrorCode::PolicyDenied);
            assert!(!error.retryable);
        }
        outcome => panic!("expected failure, got {:?}", outcome),
    }
}

#[tokio::test]
async fn plan_escalation_includes_context_when_rules_do_not_match() {
    let payload = sample_request();
    let body = serde_json::to_vec(&payload).expect("serialize plan request");

    let (state, policy_server, wallet_server, _postgres) = planner_state(serde_json::json!({
        "decision": "escalate",
        "rules": [
            {
                "rule": "legal_compliance",
                "outcome": "approve",
                "detail": "Policy service defaulted to escalation",
            }
        ],
    }))
    .await;

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

    match plan.outcome {
        PlanOutcome::Escalate { escalation } => {
            assert!(escalation.rationale.is_some());
        }
        outcome => panic!("expected escalation, got {:?}", outcome),
    }
}

#[tokio::test]
async fn plan_failure_includes_details_when_rules_do_not_match() {
    let payload = sample_request();
    let body = serde_json::to_vec(&payload).expect("serialize plan request");

    let (state, policy_server, wallet_server, _postgres) = planner_state(serde_json::json!({
        "decision": "deny",
        "rules": [
            {
                "rule": "spend_limit",
                "outcome": "escalate",
                "detail": "Escalation escalated to deny",
            }
        ],
    }))
    .await;

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

    match plan.outcome {
        PlanOutcome::Failure { error } => {
            assert!(error.detail.is_some());
        }
        outcome => panic!("expected failure, got {:?}", outcome),
    }
}

async fn mock_policy(response: serde_json::Value) -> (PolicyClient, JoinHandle<()>) {
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

async fn planner_state(
    policy_response: serde_json::Value,
) -> (PlannerState, JoinHandle<()>, JoinHandle<()>, TestPostgres) {
    planner_state_with_pipeline(policy_response, Arc::new(DefaultDiscoveryPipeline::new())).await
}

async fn planner_state_with_pipeline(
    policy_response: serde_json::Value,
    discovery: Arc<dyn DiscoveryPipeline + Send + Sync>,
) -> (PlannerState, JoinHandle<()>, JoinHandle<()>, TestPostgres) {
    let (policy_client, server) = mock_policy(policy_response).await;
    let thresholds = Thresholds {
        auto_approve_minor_units: 10_000,
        hard_deny_minor_units: 50_000,
    };
    let (wallet_client, wallet_server) = start_wallet_stub(thresholds).await;
    let postgres = TestPostgres::start().await.expect("start postgres fixture");
    let event_log = EventLog::from_pool(postgres.pool().clone());
    event_log.migrate().await.expect("migrate planner schema");

    (
        PlannerState {
            policy_client,
            event_log,
            discovery,
            wallet_client,
        },
        server,
        wallet_server,
        postgres,
    )
}
