use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use chrono::Utc;
use serde::Serialize;
use serde_json::{Map as JsonMap, Value, json};
use tower_http::limit::RequestBodyLimitLayer;
use uuid::Uuid;

use crate::policy::{PolicyClient, PolicyDecision, PolicyDecisionKind, PolicyRuleDecision};
use crate::{
    ActionArguments, ActionPrimitive, ActionPrimitiveKind, PlanError, PlanErrorCode,
    PlanEscalation, PlanOutcome, PlanRequest, PlanResponse, PlanSummary,
};

pub const DEFAULT_BIND_ADDR: &str = "0.0.0.0:8083";
pub const MAX_PLAN_REQUEST_BYTES: usize = 256 * 1024; // 256 KiB safety rail for ingress payloads.

#[derive(Clone, Copy, Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Clone, Serialize)]
struct ValidationError {
    error: &'static str,
    message: String,
}

#[derive(Clone)]
pub struct PlannerState {
    pub policy_client: PolicyClient,
}

pub fn build_router(state: PlannerState) -> Router {
    Router::new()
        .route("/plan", post(plan))
        .route("/healthz", get(health))
        .layer(RequestBodyLimitLayer::new(MAX_PLAN_REQUEST_BYTES))
        .with_state(state)
}

#[tracing::instrument(skip_all)]
async fn plan(
    State(state): State<PlannerState>,
    Json(payload): Json<PlanRequest>,
) -> Result<Json<PlanResponse>, (StatusCode, Json<ValidationError>)> {
    tracing::debug!("plan request received");

    if payload.request_id.trim().is_empty() {
        return Err(bad_request("request_id must not be empty"));
    }

    if payload.subject_id.trim().is_empty() {
        return Err(bad_request("subject_id must not be empty"));
    }

    let policy_result = state.policy_client.check(&payload).await;

    match policy_result {
        Ok(decision) => handle_policy_decision(&payload, decision),
        Err(error) => {
            tracing::warn!(error = %error, "policy check failed");
            Ok(Json(make_plan_response(
                &payload,
                PlanOutcome::Failure {
                    error: PlanError {
                        code: PlanErrorCode::Internal,
                        message: "Policy gate unavailable".into(),
                        detail: Some(error.to_string()),
                        retryable: true,
                    },
                },
            )))
        }
    }
}

#[tracing::instrument(name = "planner.health", skip_all)]
async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

fn stub_steps() -> Vec<ActionPrimitive> {
    let mut research_args = JsonMap::new();
    research_args.insert(
        "intent".to_string(),
        Value::String("collect_clarifying_details".into()),
    );
    research_args.insert(
        "notes".to_string(),
        Value::String("Review memory and prior commitments".into()),
    );

    let mut message_args = JsonMap::new();
    message_args.insert("channel".to_string(), Value::String("internal".into()));
    message_args.insert(
        "body".to_string(),
        Value::String("Queue operator follow-up for confirmation".into()),
    );

    let research = ActionPrimitive::new(ActionPrimitiveKind::Research, research_args);
    let follow_up = ActionPrimitive::new(ActionPrimitiveKind::Message, message_args)
        .with_postcondition(json!({ "status": "queued" }));

    vec![research, follow_up]
}

fn bad_request(message: impl Into<String>) -> (StatusCode, Json<ValidationError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ValidationError {
            error: "invalid_request",
            message: message.into(),
        }),
    )
}

fn make_plan_response(request: &PlanRequest, outcome: PlanOutcome) -> PlanResponse {
    PlanResponse {
        plan_id: format!("plan-{}", Uuid::new_v4().simple()),
        request_id: request.request_id.clone(),
        created_at: Utc::now(),
        trace_id: Some(Uuid::new_v4().to_string()),
        outcome,
    }
}

fn handle_policy_decision(
    request: &PlanRequest,
    decision: PolicyDecision,
) -> Result<Json<PlanResponse>, (StatusCode, Json<ValidationError>)> {
    let rule_outcomes: Vec<String> = decision
        .rules
        .iter()
        .map(|rule| format!("{:?}:{:?}", rule.rule, rule.outcome))
        .collect();
    tracing::info!(
        decision = ?decision.decision,
        rules = ?rule_outcomes,
        "policy decision received"
    );

    let response = match decision.decision {
        PolicyDecisionKind::Approve => make_plan_response(
            request,
            PlanOutcome::Success {
                steps: stub_steps(),
                summary: PlanSummary {
                    synopsis: Some(format!("Stub plan prepared for {}", request.subject_id)),
                },
            },
        ),
        PolicyDecisionKind::Escalate => make_plan_response(
            request,
            PlanOutcome::Escalate {
                escalation: build_policy_escalation(&decision),
            },
        ),
        PolicyDecisionKind::Deny => make_plan_response(
            request,
            PlanOutcome::Failure {
                error: build_policy_failure(&decision),
            },
        ),
    };

    Ok(Json(response))
}

fn build_policy_escalation(decision: &PolicyDecision) -> PlanEscalation {
    let mut relevant_rules: Vec<&PolicyRuleDecision> = decision
        .rules
        .iter()
        .filter(|rule| matches!(rule.outcome, PolicyDecisionKind::Escalate))
        .collect();

    if relevant_rules.is_empty() {
        relevant_rules = decision.rules.iter().collect();
    }

    let rationale_text = relevant_rules
        .iter()
        .map(|rule| format!("{:?}: {}", rule.rule, rule.detail))
        .collect::<Vec<_>>()
        .join("\n");

    let rationale = if rationale_text.is_empty() {
        None
    } else {
        Some(rationale_text)
    };

    let context = json!({
        "decision": "escalate",
        "rules": relevant_rules
            .iter()
            .map(|rule| json!({
                "rule": format!("{:?}", rule.rule),
                "detail": rule.detail,
            }))
            .collect::<Vec<_>>()
    });

    let args = ActionArguments::from_iter([
        (
            "prompt".into(),
            json!("Policy review required before execution."),
        ),
        ("context".into(), context),
    ]);

    let action = ActionPrimitive::new(ActionPrimitiveKind::Confirm, args);

    PlanEscalation {
        step_index: 0,
        action,
        rationale,
        expires_at: None,
    }
}

fn build_policy_failure(decision: &PolicyDecision) -> PlanError {
    let mut relevant_rules: Vec<&PolicyRuleDecision> = decision
        .rules
        .iter()
        .filter(|rule| matches!(rule.outcome, PolicyDecisionKind::Deny))
        .collect();

    if relevant_rules.is_empty() {
        relevant_rules = decision.rules.iter().collect();
    }

    let detail = if relevant_rules.is_empty() {
        None
    } else {
        Some(
            relevant_rules
                .iter()
                .map(|rule| format!("{:?}: {}", rule.rule, rule.detail))
                .collect::<Vec<_>>()
                .join("\n"),
        )
    };

    PlanError {
        code: PlanErrorCode::PolicyDenied,
        message: "Policy gate denied the plan".into(),
        detail,
        retryable: false,
    }
}
