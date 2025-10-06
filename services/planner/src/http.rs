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
    ActionArguments, ActionPrimitive, ActionPrimitiveKind, EventLog, NewPlannerEvent, PlanError,
    PlanErrorCode, PlanEscalation, PlanOutcome, PlanRequest, PlanResponse, PlanSummary,
};
use tyrum_shared::{MessageSource, PiiField, ThreadKind};

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
    pub event_log: EventLog,
}

pub fn build_router(state: PlannerState) -> Router {
    Router::new()
        .route("/plan", post(plan))
        .route("/healthz", get(health))
        .layer(RequestBodyLimitLayer::new(MAX_PLAN_REQUEST_BYTES))
        .with_state(state)
}

const DECISION_AUDIT_STEP_INDEX: i32 = i32::MAX;

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

    let plan_uuid = Uuid::new_v4();
    let policy_result = state.policy_client.check(&payload).await;

    let (outcome, policy_audit) = match policy_result {
        Ok(decision) => {
            let outcome = build_outcome_for_decision(&payload, &decision);
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
            (outcome, PolicyAudit::from_decision(&decision))
        }
        Err(error) => {
            tracing::warn!(error = %error, "policy check failed");
            let reason = error.to_string();
            let outcome = PlanOutcome::Failure {
                error: PlanError {
                    code: PlanErrorCode::Internal,
                    message: "Policy gate unavailable".into(),
                    detail: Some(reason.clone()),
                    retryable: true,
                },
            };
            (outcome, PolicyAudit::unavailable(reason))
        }
    };

    let plan_id = format_plan_id(plan_uuid);
    let audit_event =
        PlannerDecisionAudit::new(plan_uuid, &plan_id, &payload, policy_audit, &outcome);

    match NewPlannerEvent::from_payload(
        Uuid::new_v4(),
        plan_uuid,
        DECISION_AUDIT_STEP_INDEX,
        Utc::now(),
        &audit_event,
    ) {
        Ok(event) => {
            if let Err(error) = state.event_log.append(event).await {
                tracing::error!(
                    plan_id = plan_id.as_str(),
                    %error,
                    "failed to append planner audit event"
                );
            }
        }
        Err(error) => {
            tracing::error!(
                plan_id = plan_id.as_str(),
                %error,
                "failed to encode planner audit payload"
            );
        }
    }

    Ok(Json(make_plan_response(plan_id, &payload, outcome)))
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

fn make_plan_response(
    plan_id: String,
    request: &PlanRequest,
    outcome: PlanOutcome,
) -> PlanResponse {
    PlanResponse {
        plan_id,
        request_id: request.request_id.clone(),
        created_at: Utc::now(),
        trace_id: Some(Uuid::new_v4().to_string()),
        outcome,
    }
}

fn format_plan_id(plan_uuid: Uuid) -> String {
    format!("plan-{}", plan_uuid.simple())
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

fn build_outcome_for_decision(request: &PlanRequest, decision: &PolicyDecision) -> PlanOutcome {
    match decision.decision {
        PolicyDecisionKind::Approve => PlanOutcome::Success {
            steps: stub_steps(),
            summary: PlanSummary {
                synopsis: Some(format!("Stub plan prepared for {}", request.subject_id)),
            },
        },
        PolicyDecisionKind::Escalate => PlanOutcome::Escalate {
            escalation: build_policy_escalation(decision),
        },
        PolicyDecisionKind::Deny => PlanOutcome::Failure {
            error: build_policy_failure(decision),
        },
    }
}

#[derive(Serialize)]
struct PlannerDecisionAudit {
    plan_id: String,
    plan_uuid: Uuid,
    request: RedactedRequest,
    policy: PolicyAudit,
    outcome: PlanOutcomeAudit,
}

impl PlannerDecisionAudit {
    fn new(
        plan_uuid: Uuid,
        plan_id: &str,
        request: &PlanRequest,
        policy: PolicyAudit,
        outcome: &PlanOutcome,
    ) -> Self {
        Self {
            plan_id: plan_id.to_owned(),
            plan_uuid,
            request: RedactedRequest::from_plan_request(request),
            policy,
            outcome: PlanOutcomeAudit::from(outcome),
        }
    }
}

#[derive(Serialize)]
struct RedactedRequest {
    request_id: String,
    subject_id: String,
    tags: Vec<String>,
    trigger: RedactedTrigger,
}

impl RedactedRequest {
    fn from_plan_request(request: &PlanRequest) -> Self {
        Self {
            request_id: request.request_id.clone(),
            subject_id: request.subject_id.clone(),
            tags: request.tags.clone(),
            trigger: RedactedTrigger::from_trigger(&request.trigger),
        }
    }
}

#[derive(Serialize)]
struct RedactedTrigger {
    thread_id: String,
    thread_kind: ThreadKind,
    message_id: String,
    message_source: MessageSource,
    thread_pii_fields: Vec<PiiField>,
    message_pii_fields: Vec<PiiField>,
}

impl RedactedTrigger {
    fn from_trigger(trigger: &tyrum_shared::NormalizedThreadMessage) -> Self {
        // We intentionally omit thread/message fields flagged as PII and record only
        // identifiers plus declared PII categories so audit trails remain traceable
        // without storing personal data verbatim.
        Self {
            thread_id: trigger.thread.id.clone(),
            thread_kind: trigger.thread.kind,
            message_id: trigger.message.id.clone(),
            message_source: trigger.message.source,
            thread_pii_fields: trigger.thread.pii_fields.clone(),
            message_pii_fields: trigger.message.pii_fields.clone(),
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum PolicyAudit {
    Evaluated {
        decision: String,
        rules: Vec<PolicyRuleAudit>,
    },
    Unavailable {
        reason: String,
    },
}

impl PolicyAudit {
    fn from_decision(decision: &PolicyDecision) -> Self {
        let rules = decision
            .rules
            .iter()
            .map(|rule| PolicyRuleAudit {
                rule: format!("{:?}", rule.rule),
                outcome: format!("{:?}", rule.outcome),
                detail: rule.detail.clone(),
            })
            .collect();

        Self::Evaluated {
            decision: format!("{:?}", decision.decision),
            rules,
        }
    }

    fn unavailable(reason: String) -> Self {
        Self::Unavailable { reason }
    }
}

#[derive(Serialize)]
struct PolicyRuleAudit {
    rule: String,
    outcome: String,
    detail: String,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum PlanOutcomeAudit {
    Success {
        step_count: usize,
        steps: Vec<LoggedStep>,
        summary_present: bool,
    },
    Escalate {
        step_index: usize,
        action_kind: ActionPrimitiveKind,
        arg_keys: Vec<String>,
        rationale_present: bool,
    },
    Failure {
        code: PlanErrorCode,
        retryable: bool,
        detail_present: bool,
    },
}

impl From<&PlanOutcome> for PlanOutcomeAudit {
    fn from(outcome: &PlanOutcome) -> Self {
        match outcome {
            PlanOutcome::Success { steps, summary } => PlanOutcomeAudit::Success {
                step_count: steps.len(),
                steps: steps
                    .iter()
                    .enumerate()
                    .map(|(idx, step)| LoggedStep::from_step(idx, step))
                    .collect(),
                summary_present: summary
                    .synopsis
                    .as_ref()
                    .is_some_and(|synopsis| !synopsis.is_empty()),
            },
            PlanOutcome::Escalate { escalation } => PlanOutcomeAudit::Escalate {
                step_index: escalation.step_index,
                action_kind: escalation.action.kind,
                arg_keys: escalation.action.args.keys().cloned().collect(),
                rationale_present: escalation
                    .rationale
                    .as_ref()
                    .is_some_and(|value| !value.is_empty()),
            },
            PlanOutcome::Failure { error } => PlanOutcomeAudit::Failure {
                code: error.code,
                retryable: error.retryable,
                detail_present: error.detail.as_ref().is_some_and(|value| !value.is_empty()),
            },
        }
    }
}

#[derive(Serialize)]
struct LoggedStep {
    step_index: usize,
    kind: ActionPrimitiveKind,
    arg_keys: Vec<String>,
    has_postcondition: bool,
    has_idempotency_key: bool,
}

impl LoggedStep {
    fn from_step(index: usize, step: &ActionPrimitive) -> Self {
        Self {
            step_index: index,
            kind: step.kind,
            arg_keys: step.args.keys().cloned().collect(),
            has_postcondition: step.postcondition.is_some(),
            has_idempotency_key: step.idempotency_key.is_some(),
        }
    }
}
