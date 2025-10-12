#![allow(clippy::expect_used, clippy::unwrap_used)]

mod common;

use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex};
use std::{borrow::Cow, collections::VecDeque};

use axum::{
    Json, Router,
    body::Body,
    http::{Request, StatusCode},
    routing::post,
};
use chrono::Utc;
use common::postgres::{TestPostgres, docker_available};
use common::wallet::start_wallet_stub;
use http_body_util::BodyExt;
use opentelemetry::global;
use opentelemetry_sdk::metrics::{
    InMemoryMetricExporter, PeriodicReader, SdkMeterProvider,
    data::{AggregatedMetrics, MetricData, ResourceMetrics},
};
use reqwest::Url;
use tokio::{net::TcpListener, task::JoinHandle};
use tower::{Service, ServiceExt};
use tyrum_discovery::{
    DefaultDiscoveryPipeline, DiscoveryConnector, DiscoveryOutcome, DiscoveryPipeline,
    DiscoveryRequest, DiscoveryResolution, DiscoveryStrategy, InMemoryConnectorCache,
};
use tyrum_memory::{MemoryDal, PamProfileUpsert};
use tyrum_planner::{
    ActionPrimitiveKind, CapabilityMemoryService, EventLog, PlanOutcome, PlanRequest, PlanResponse,
    ProfileStore,
    http::{MAX_PLAN_REQUEST_BYTES, PlannerState, build_router},
    policy::PolicyClient,
};
use tyrum_shared::{
    MessageContent, MessageSource, NormalizedMessage, NormalizedThread, NormalizedThreadMessage,
    PamProfileRef, PiiField, PlanUserContext, SenderMetadata, ThreadKind,
};
use tyrum_wallet::Thresholds;
use uuid::Uuid;

fn skip_if_no_docker(test_name: &str) -> bool {
    if docker_available() {
        true
    } else {
        eprintln!("skipping {test_name}: docker unavailable");
        false
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

fn connector_escalation_payload(scope: &str) -> serde_json::Value {
    serde_json::json!({
        "decision": "escalate",
        "rules": [
            {
                "rule": "connector_scope",
                "outcome": "escalate",
                "detail": format!("Consent required for {scope}"),
            }
        ],
    })
}

fn connector_approval_payload(scope: &str) -> serde_json::Value {
    serde_json::json!({
        "decision": "approve",
        "rules": [
            {
                "rule": "connector_scope",
                "outcome": "approve",
                "detail": format!("Connector scope {scope} already granted."),
            }
        ],
    })
}

fn found_connector(strategy: DiscoveryStrategy, locator: &str) -> DiscoveryOutcome {
    DiscoveryOutcome::Found(DiscoveryResolution::single(DiscoveryConnector {
        strategy,
        locator: locator.to_string(),
        rank: 1,
    }))
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
    if !skip_if_no_docker("plan_returns_stub_response") {
        return;
    }
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
    if !skip_if_no_docker("discovery_pipeline_uses_mcp_capability") {
        return;
    }
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
    if !skip_if_no_docker("discovery_pipeline_uses_structured_api_capability") {
        return;
    }
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
async fn planner_escalates_when_connector_requires_consent() {
    if !skip_if_no_docker("planner_escalates_when_connector_requires_consent") {
        return;
    }

    let pipeline = Arc::new(MockDiscoveryPipeline::new(
        found_connector(DiscoveryStrategy::Mcp, "mcp://restricted"),
        DiscoveryOutcome::NotFound,
        DiscoveryOutcome::NotFound,
    ));
    let discovery: Arc<dyn DiscoveryPipeline + Send + Sync> = pipeline.clone();

    let (policy_client, policy_server, captured) = policy_sequence(vec![
        approving_policy_payload(),
        connector_escalation_payload("mcp://restricted"),
    ])
    .await;

    let thresholds = Thresholds {
        auto_approve_minor_units: 10_000,
        hard_deny_minor_units: 50_000,
    };
    let (wallet_client, wallet_server) = start_wallet_stub(thresholds).await;
    let postgres = TestPostgres::start().await.expect("start postgres fixture");
    let event_log = EventLog::from_pool(postgres.pool().clone());
    event_log.migrate().await.expect("migrate planner schema");
    let profiles = ProfileStore::new(event_log.pool().clone());
    let capability_memory = CapabilityMemoryService::new(MemoryDal::new(event_log.pool().clone()));

    let state = PlannerState {
        policy_client,
        event_log,
        discovery,
        wallet_client,
        profiles,
        capability_memory,
        risk_classifier: None,
    };

    let payload = sample_request();
    let body = serde_json::to_vec(&payload).expect("serialize plan request");

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

    let escalation = match plan.outcome {
        PlanOutcome::Escalate { escalation } => escalation,
        other => panic!("expected escalation, got {other:?}"),
    };

    assert!(
        escalation
            .rationale
            .as_ref()
            .is_some_and(|text| text.contains("mcp://restricted"))
    );
    let prompt = escalation
        .action
        .args
        .get("prompt")
        .and_then(|value| value.as_str())
        .expect("prompt present");
    assert!(prompt.contains("mcp://restricted"));

    let payloads = captured.lock().expect("capture policy payloads").clone();
    assert_eq!(payloads.len(), 2, "expected plan and scope checks");
    let connector_scope = payloads[1]
        .get("connector")
        .and_then(|value| value.get("scope"))
        .and_then(|value| value.as_str());
    assert_eq!(connector_scope, Some("mcp://restricted"));
}

#[tokio::test]
async fn planner_filters_blocked_connectors_before_returning() {
    if !skip_if_no_docker("planner_filters_blocked_connectors_before_returning") {
        return;
    }

    let primary = DiscoveryConnector {
        strategy: DiscoveryStrategy::Mcp,
        locator: "mcp://restricted".into(),
        rank: 1,
    };
    let allowed = DiscoveryConnector {
        strategy: DiscoveryStrategy::StructuredApi,
        locator: "https://api.allowed.com".into(),
        rank: 2,
    };
    let resolution = DiscoveryResolution {
        primary: primary.clone(),
        alternatives: vec![allowed.clone()],
    };

    let pipeline = Arc::new(MockDiscoveryPipeline::new(
        DiscoveryOutcome::Found(resolution),
        DiscoveryOutcome::NotFound,
        DiscoveryOutcome::NotFound,
    ));
    let discovery: Arc<dyn DiscoveryPipeline + Send + Sync> = pipeline.clone();

    let (policy_client, policy_server, captured) = policy_sequence(vec![
        approving_policy_payload(),
        connector_escalation_payload("mcp://restricted"),
        connector_approval_payload("https://api.allowed.com"),
    ])
    .await;

    let thresholds = Thresholds {
        auto_approve_minor_units: 10_000,
        hard_deny_minor_units: 50_000,
    };
    let (wallet_client, wallet_server) = start_wallet_stub(thresholds).await;
    let postgres = TestPostgres::start().await.expect("start postgres fixture");
    let event_log = EventLog::from_pool(postgres.pool().clone());
    event_log.migrate().await.expect("migrate planner schema");
    let profiles = ProfileStore::new(event_log.pool().clone());
    let capability_memory = CapabilityMemoryService::new(MemoryDal::new(event_log.pool().clone()));

    let state = PlannerState {
        policy_client,
        event_log,
        discovery,
        wallet_client,
        profiles,
        capability_memory,
        risk_classifier: None,
    };

    let payload = sample_request();
    let body = serde_json::to_vec(&payload).expect("serialize plan request");

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

    let (steps, summary) = match plan.outcome {
        PlanOutcome::Success { steps, summary } => (steps, summary),
        other => panic!("expected success, got {other:?}"),
    };

    assert_eq!(steps[1].kind, ActionPrimitiveKind::Http);
    assert_eq!(
        steps[1]
            .args
            .get("locator")
            .and_then(|value| value.as_str()),
        Some("https://api.allowed.com")
    );
    assert!(
        summary
            .synopsis
            .as_ref()
            .is_some_and(|text| text.contains("Discovered structured_api capability"))
    );

    let payloads = captured.lock().expect("capture policy payloads").clone();
    assert_eq!(payloads.len(), 3, "expected plan plus two scope checks");
    let second_scope = payloads[1]
        .get("connector")
        .and_then(|value| value.get("scope"))
        .and_then(|value| value.as_str());
    assert_eq!(second_scope, Some("mcp://restricted"));
    let third_scope = payloads[2]
        .get("connector")
        .and_then(|value| value.get("scope"))
        .and_then(|value| value.as_str());
    assert_eq!(third_scope, Some("https://api.allowed.com"));
}

#[tokio::test]
async fn discovery_cache_records_hit_metric() {
    if !skip_if_no_docker("discovery_cache_records_hit_metric") {
        return;
    }

    let exporter = InMemoryMetricExporter::default();
    let reader = PeriodicReader::builder(exporter.clone()).build();
    let meter_provider = SdkMeterProvider::builder().with_reader(reader).build();
    global::set_meter_provider(meter_provider.clone());

    let cache = Arc::new(InMemoryConnectorCache::new());
    let pipeline = Arc::new(DefaultDiscoveryPipeline::with_cache_backend(
        cache,
        "planner-cache",
        NonZeroUsize::new(5).unwrap(),
    ));

    let mut payload = sample_request();
    payload.subject_id = "https://api.example.com/v1/openapi.json".into();
    let body = serde_json::to_vec(&payload).expect("serialize plan request");

    let (state, policy_server, wallet_server, _postgres) =
        planner_state_with_pipeline(approving_policy_payload(), pipeline).await;

    let mut app = build_router(state);

    let response = app
        .call(
            Request::builder()
                .method("POST")
                .uri("/plan")
                .header("content-type", "application/json")
                .body(Body::from(body.clone()))
                .expect("construct request"),
        )
        .await
        .expect("receive response");
    assert_eq!(response.status(), StatusCode::OK);

    meter_provider
        .force_flush()
        .expect("flush metrics after miss");

    let response = app
        .call(
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

    meter_provider
        .force_flush()
        .expect("flush metrics after hit");
    meter_provider.shutdown().expect("shutdown meter provider");

    let metrics = exporter
        .get_finished_metrics()
        .expect("read exported metrics");
    let (hits, misses) = cache_event_counts(&metrics);
    assert!(hits >= 1, "expected cache hit metric, got {:?}", metrics);
    assert!(misses >= 1, "expected cache miss metric, got {:?}", metrics);

    global::set_meter_provider(SdkMeterProvider::builder().build());

    policy_server.abort();
    wallet_server.abort();
}

#[tokio::test]
async fn discovery_pipeline_uses_generic_http_capability() {
    if !skip_if_no_docker("discovery_pipeline_uses_generic_http_capability") {
        return;
    }
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
    if !skip_if_no_docker("plan_rejects_oversized_payloads") {
        return;
    }
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
    if !skip_if_no_docker("plan_escalates_on_policy_escalation") {
        return;
    }
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
    if !skip_if_no_docker("plan_returns_failure_on_policy_denial") {
        return;
    }
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
async fn planner_injects_pam_profile_reference_from_store() {
    use axum::extract::State;

    if !skip_if_no_docker("planner_injects_pam_profile_reference_from_store") {
        return;
    }

    let subject_id = Uuid::new_v4();
    let pam_version = Uuid::new_v4();
    let recordings: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(Vec::new()));

    let policy_response = approving_policy_payload();
    let policy_state = recordings.clone();
    let policy_app = Router::new()
        .route(
            "/policy/check",
            post({
                move |State(state): State<Arc<Mutex<Vec<serde_json::Value>>>>,
                      Json(payload): Json<serde_json::Value>| {
                    let response = policy_response.clone();
                    async move {
                        state.lock().expect("record policy payload").push(payload);
                        Json(response)
                    }
                }
            }),
        )
        .with_state(policy_state);

    let policy_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind policy listener");
    let policy_addr = policy_listener.local_addr().expect("policy addr");
    let policy_url = Url::parse(&format!("http://{}", policy_addr)).expect("construct policy url");

    let policy_server = tokio::spawn(async move {
        axum::serve(policy_listener, policy_app)
            .await
            .expect("policy server failed");
    });

    let policy_client = PolicyClient::new(policy_url);
    let thresholds = Thresholds {
        auto_approve_minor_units: 10_000,
        hard_deny_minor_units: 50_000,
    };
    let (wallet_client, wallet_server) = start_wallet_stub(thresholds).await;
    let postgres = TestPostgres::start().await.expect("start postgres fixture");
    let event_log = EventLog::from_pool(postgres.pool().clone());
    event_log.migrate().await.expect("migrate planner schema");
    let profiles = ProfileStore::new(event_log.pool().clone());

    let memory = MemoryDal::new(postgres.pool().clone());
    memory
        .upsert_pam_profile(PamProfileUpsert {
            subject_id,
            profile_id: "pam-default".into(),
            profile: serde_json::json!({
                "escalation_mode": "ask_first"
            }),
            confidence: None,
            version: Some(pam_version),
        })
        .await
        .expect("seed pam profile");
    let capability_memory = CapabilityMemoryService::new(memory.clone());

    let state = PlannerState {
        policy_client,
        event_log,
        discovery: Arc::new(DefaultDiscoveryPipeline::new()),
        wallet_client,
        profiles,
        capability_memory,
        risk_classifier: None,
    };

    let mut request = sample_request();
    request.subject_id = subject_id.to_string();
    request.user = None;

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

    assert_eq!(response.status(), StatusCode::OK);

    let recorded = recordings.lock().expect("read recorded payloads");
    let policy_payload = recorded.first().expect("policy payload recorded");
    let pam_profile = policy_payload
        .get("pam_profile")
        .expect("pam profile present")
        .as_object()
        .expect("pam profile object");

    assert_eq!(
        pam_profile
            .get("profile_id")
            .and_then(|value| value.as_str()),
        Some("pam-default")
    );
    assert_eq!(
        pam_profile
            .get("version")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        Some(pam_version.to_string())
    );
    assert_eq!(
        policy_payload
            .get("user_id")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        Some(subject_id.to_string())
    );
}

#[tokio::test]
async fn plan_escalation_includes_context_when_rules_do_not_match() {
    if !skip_if_no_docker("plan_escalation_includes_context_when_rules_do_not_match") {
        return;
    }
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
    if !skip_if_no_docker("plan_failure_includes_details_when_rules_do_not_match") {
        return;
    }
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

async fn policy_sequence(
    responses: Vec<serde_json::Value>,
) -> (
    PolicyClient,
    JoinHandle<()>,
    Arc<Mutex<Vec<serde_json::Value>>>,
) {
    assert!(
        !responses.is_empty(),
        "policy sequence requires at least one response"
    );
    let captured: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(Vec::new()));
    let queue: Arc<Mutex<VecDeque<serde_json::Value>>> =
        Arc::new(Mutex::new(VecDeque::from(responses.clone())));
    let fallback = responses.last().expect("sequence fallback").clone();

    let app = Router::new().route(
        "/policy/check",
        post({
            let queue = Arc::clone(&queue);
            let captured = Arc::clone(&captured);
            move |Json(payload): Json<serde_json::Value>| {
                let queue = Arc::clone(&queue);
                let captured = Arc::clone(&captured);
                let fallback = fallback.clone();
                async move {
                    captured
                        .lock()
                        .expect("record policy payload")
                        .push(payload);
                    let response = queue
                        .lock()
                        .expect("lock policy response queue")
                        .pop_front()
                        .unwrap_or_else(|| fallback.clone());
                    Json(response)
                }
            }
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

    (PolicyClient::new(url), server, captured)
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
    let profiles = ProfileStore::new(event_log.pool().clone());
    let capability_memory = CapabilityMemoryService::new(MemoryDal::new(event_log.pool().clone()));

    (
        PlannerState {
            policy_client,
            event_log,
            discovery,
            wallet_client,
            profiles,
            capability_memory,
            risk_classifier: None,
        },
        server,
        wallet_server,
        postgres,
    )
}

fn cache_event_counts(metrics: &[ResourceMetrics]) -> (u64, u64) {
    let mut hits = 0;
    let mut misses = 0;

    for resource in metrics {
        for scope in resource.scope_metrics() {
            for metric in scope.metrics() {
                if metric.name() != "discovery.cache.hit" {
                    continue;
                }

                if let AggregatedMetrics::U64(MetricData::Sum(sum)) = metric.data() {
                    for point in sum.data_points() {
                        let status = point
                            .attributes()
                            .find(|attr| attr.key.as_str() == "status")
                            .map(|attr| attr.value.as_str())
                            .unwrap_or_else(|| Cow::Borrowed(""));
                        match status.as_ref() {
                            "hit" => hits += point.value(),
                            "miss" => misses += point.value(),
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    (hits, misses)
}
