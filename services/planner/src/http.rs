use std::{convert::TryFrom, sync::Arc};

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

use crate::capability_memory::CapabilityMemoryService;
use crate::policy::{PolicyClient, PolicyDecision, PolicyDecisionKind, PolicyRuleDecision};
use crate::wallet::{AuthorizationDecision, SpendAuthorization, WalletClient};
use crate::{
    ActionArguments, ActionPrimitive, ActionPrimitiveKind, EventLog, NewPlannerEvent, PlanError,
    PlanErrorCode, PlanEscalation, PlanOutcome, PlanRequest, PlanResponse, PlanSummary,
    PlanUserContext, ProfileStore,
};
use tyrum_discovery::{
    DiscoveryConnector, DiscoveryOutcome, DiscoveryPipeline, DiscoveryRequest, DiscoveryResolution,
    DiscoveryStrategy,
};
use tyrum_risk_classifier::{RiskClassifier, RiskInput, RiskLevel, RiskVerdict, SpendContext};
use tyrum_shared::{MessageSource, PamProfileRef, PiiField, ThreadKind};

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
    pub discovery: Arc<dyn DiscoveryPipeline + Send + Sync>,
    pub wallet_client: WalletClient,
    pub profiles: ProfileStore,
    pub capability_memory: CapabilityMemoryService,
    pub risk_classifier: Option<RiskClassifier>,
}

impl PlannerState {
    async fn enrich_user_context(&self, request: &mut PlanRequest) {
        let Some(subject_id) = Self::parse_subject_uuid(&request.subject_id) else {
            return;
        };

        let (profile_id, has_version) = Self::desired_pam_profile(request);

        if has_version {
            Self::ensure_user_id_if_present(request);
            return;
        }

        self.attach_latest_profile(request, subject_id, profile_id)
            .await;
    }
}

impl PlannerState {
    fn parse_subject_uuid(raw: &str) -> Option<Uuid> {
        match Uuid::parse_str(raw.trim()) {
            Ok(uuid) => Some(uuid),
            Err(error) => {
                tracing::debug!(%error, "subject_id is not a valid UUID; skipping PAM lookup");
                None
            }
        }
    }
    fn desired_pam_profile(request: &PlanRequest) -> (String, bool) {
        request
            .user
            .as_ref()
            .and_then(|context| context.pam_profile.as_ref())
            .map(|pam| {
                let has_version = pam
                    .version
                    .as_ref()
                    .map(|version| !version.trim().is_empty())
                    .unwrap_or(false);
                (pam.profile_id.clone(), has_version)
            })
            .unwrap_or_else(|| ("pam-default".to_string(), false))
    }

    fn ensure_user_id_if_present(request: &mut PlanRequest) {
        if let Some(context) = request.user.as_mut() {
            Self::ensure_user_id(&request.subject_id, context);
        }
    }

    async fn attach_latest_profile(
        &self,
        request: &mut PlanRequest,
        subject_id: Uuid,
        profile_id: String,
    ) {
        let profile_key = profile_id.as_str();
        let lookup = match self.profiles.pam_profile_ref(subject_id, profile_key).await {
            Ok(result) => result,
            Err(error) => {
                tracing::warn!(
                    %error,
                    subject_id = %request.subject_id,
                    profile_id = profile_key,
                    "failed to load PAM profile reference"
                );
                return;
            }
        };

        let Some(reference) = lookup else {
            Self::ensure_user_id_if_present(request);
            return;
        };

        Self::attach_pam_profile(request, reference);
    }

    fn ensure_user_id(subject_id: &str, context: &mut PlanUserContext) {
        if context.user_id.trim().is_empty() {
            context.user_id = subject_id.to_string();
        }
    }

    fn attach_pam_profile(request: &mut PlanRequest, reference: PamProfileRef) {
        let subject_id = request.subject_id.clone();
        match request.user.as_mut() {
            Some(context) => {
                Self::ensure_user_id(&subject_id, context);
                context.pam_profile = Some(reference);
            }
            None => {
                request.user = Some(PlanUserContext {
                    user_id: subject_id,
                    pam_profile: Some(reference),
                });
            }
        }
    }
}

pub fn build_router(state: PlannerState) -> Router {
    Router::new()
        .route("/plan", post(plan))
        .route("/healthz", get(health))
        .layer(RequestBodyLimitLayer::new(MAX_PLAN_REQUEST_BYTES))
        .with_state(state)
}

const DECISION_AUDIT_STEP_INDEX: i32 = i32::MAX;
const WALLET_GUARDRAIL_NOTE: &str = "Spend guardrail enforced by wallet authorization.";

#[tracing::instrument(skip_all)]
async fn plan(
    State(state): State<PlannerState>,
    Json(payload): Json<PlanRequest>,
) -> Result<Json<PlanResponse>, (StatusCode, Json<ValidationError>)> {
    tracing::debug!("plan request received");
    let mut payload = payload;

    if payload.request_id.trim().is_empty() {
        return Err(bad_request("request_id must not be empty"));
    }

    if payload.subject_id.trim().is_empty() {
        return Err(bad_request("subject_id must not be empty"));
    }

    let subject_uuid = PlannerState::parse_subject_uuid(&payload.subject_id);
    state.enrich_user_context(&mut payload).await;

    let plan_uuid = Uuid::new_v4();
    let plan_id = format_plan_id(plan_uuid);
    let spend_directive = extract_spend_directive(&payload);
    let policy_result = state.policy_client.check(&payload).await;

    let (outcome, policy_audit, discovery_audit, wallet_audit) = match policy_result {
        Ok(decision) => {
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

            let (mut outcome, discovery_audit) = build_outcome_for_decision(
                &payload,
                &decision,
                state.discovery.as_ref(),
                spend_directive.as_ref(),
            );

            if let Some(subject_id) = subject_uuid
                && let PlanOutcome::Success { steps, .. } = &mut outcome
            {
                state
                    .capability_memory
                    .hydrate_primitives(subject_id, steps)
                    .await;
            }

            let mut wallet_audit = WalletAudit::skipped();

            if let PlanOutcome::Success { steps, .. } = &mut outcome {
                if let Some(spend) = first_spend_request(steps) {
                    let authorization = SpendAuthorization {
                        request_id: Some(plan_id.clone()),
                        amount_minor_units: spend.amount_minor_units,
                        currency: spend.currency.clone(),
                        merchant_name: spend.merchant.clone(),
                    };

                    match state.wallet_client.authorize(&authorization).await {
                        Ok(response) => {
                            let sanitized_reason = sanitize_detail(&response.reason);
                            let decision = response.decision;
                            wallet_audit =
                                WalletAudit::evaluated(decision, sanitized_reason.clone());

                            match decision {
                                AuthorizationDecision::Approve => {
                                    tracing::info!("wallet approved spend");
                                }
                                AuthorizationDecision::Escalate => {
                                    tracing::info!("wallet escalated spend");
                                    outcome = PlanOutcome::Escalate {
                                        escalation: build_wallet_escalation(
                                            spend.step_index,
                                            &sanitized_reason,
                                        ),
                                    };
                                }
                                AuthorizationDecision::Deny => {
                                    tracing::info!("wallet denied spend");
                                    outcome = PlanOutcome::Failure {
                                        error: build_wallet_denial_error(&sanitized_reason),
                                    };
                                }
                            }
                        }
                        Err(error) => {
                            tracing::warn!(%error, "wallet authorization failed");
                            let detail = sanitize_detail(&error.to_string());
                            wallet_audit = WalletAudit::errored(detail.clone());
                            outcome = PlanOutcome::Failure {
                                error: PlanError {
                                    code: PlanErrorCode::Internal,
                                    message: "Wallet service unavailable".into(),
                                    detail: Some(detail),
                                    retryable: true,
                                },
                            };
                        }
                    }
                } else {
                    wallet_audit = WalletAudit::skipped();
                }
            }

            (
                outcome,
                PolicyAudit::from_decision(&decision),
                discovery_audit,
                wallet_audit,
            )
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
            (
                outcome,
                PolicyAudit::unavailable(reason),
                DiscoveryAudit::skipped(),
                WalletAudit::skipped(),
            )
        }
    };

    let risk_verdict = state.risk_classifier.as_ref().map(|classifier| {
        classify_plan_risk(classifier, &payload, spend_directive.as_ref(), &outcome)
    });

    let audit_event = PlannerDecisionAudit::new(
        plan_uuid,
        &plan_id,
        &payload,
        policy_audit,
        discovery_audit,
        wallet_audit,
        &outcome,
        risk_verdict.as_ref(),
    );

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
        let summary = relevant_rules
            .iter()
            .map(|rule| format!("{:?}: {}", rule.rule, sanitize_detail(&rule.detail)))
            .collect::<Vec<_>>()
            .join("\n");

        (!summary.is_empty()).then_some(summary)
    };

    PlanError {
        code: PlanErrorCode::PolicyDenied,
        message: "Policy gate denied the plan".into(),
        detail,
        retryable: false,
    }
}

fn build_outcome_for_decision(
    request: &PlanRequest,
    decision: &PolicyDecision,
    discovery: &dyn DiscoveryPipeline,
    spend_directive: Option<&SpendDirective>,
) -> (PlanOutcome, DiscoveryAudit) {
    match decision.decision {
        PolicyDecisionKind::Approve => {
            let discovery_request = discovery_request_for(request);
            let outcome = discovery.discover(&discovery_request);
            log_discovery_outcome(&discovery_request, &outcome);

            match &outcome {
                DiscoveryOutcome::RetryLater { retry_after } => {
                    let (detail, retry_after_ms) = match retry_after {
                        Some(duration) => {
                            let millis = duration.as_millis();
                            let capped = u64::try_from(millis).unwrap_or(u64::MAX);
                            (Some(format!("retry_after_ms={capped}")), Some(capped))
                        }
                        None => (None, None),
                    };

                    let error = PlanError {
                        code: PlanErrorCode::ExecutorUnavailable,
                        message: "Discovery pipeline requested retry".into(),
                        detail,
                        retryable: true,
                    };

                    (
                        PlanOutcome::Failure { error },
                        DiscoveryAudit::deferred(retry_after_ms),
                    )
                }
                _ => (
                    PlanOutcome::Success {
                        steps: build_plan_steps(request, &outcome, spend_directive),
                        summary: plan_summary_for(request, &outcome, spend_directive),
                    },
                    DiscoveryAudit::from_outcome(&outcome),
                ),
            }
        }
        PolicyDecisionKind::Escalate => (
            PlanOutcome::Escalate {
                escalation: build_policy_escalation(decision),
            },
            DiscoveryAudit::skipped(),
        ),
        PolicyDecisionKind::Deny => (
            PlanOutcome::Failure {
                error: build_policy_failure(decision),
            },
            DiscoveryAudit::skipped(),
        ),
    }
}

fn discovery_request_for(request: &PlanRequest) -> DiscoveryRequest {
    DiscoveryRequest {
        subject: request.subject_id.clone(),
    }
}

#[allow(clippy::cognitive_complexity)]
fn log_discovery_outcome(request: &DiscoveryRequest, outcome: &DiscoveryOutcome) {
    let subject = request.sanitized_subject();
    match outcome {
        DiscoveryOutcome::Found(resolution) => {
            let primary = &resolution.primary;
            let alternatives = resolution
                .alternatives
                .iter()
                .map(|alt| format!("{}@{}", strategy_label(alt.strategy), alt.locator))
                .collect::<Vec<_>>();
            tracing::info!(
                target: "tyrum::planner",
                subject,
                strategy = strategy_label(primary.strategy),
                locator = primary.locator.as_str(),
                rank = primary.rank,
                alternative_count = alternatives.len(),
                alternatives = %alternatives.join(","),
                "discovery resolved connector"
            );
        }
        DiscoveryOutcome::NotFound => {
            tracing::info!(
                target: "tyrum::planner",
                subject,
                "discovery returned no connector"
            );
        }
        DiscoveryOutcome::RetryLater { retry_after } => {
            let retry_ms = retry_after.map(|duration| duration.as_millis());
            tracing::warn!(
                target: "tyrum::planner",
                subject,
                retry_after_ms = retry_ms,
                "discovery requested retry"
            );
        }
    }
}

fn build_plan_steps(
    request: &PlanRequest,
    outcome: &DiscoveryOutcome,
    spend_directive: Option<&SpendDirective>,
) -> Vec<ActionPrimitive> {
    let mut steps = Vec::new();
    steps.push(research_step());

    match outcome {
        DiscoveryOutcome::Found(resolution) => {
            steps.push(discovered_execution_step(resolution));
        }
        DiscoveryOutcome::NotFound => {
            steps.push(fallback_execution_step());
        }
        DiscoveryOutcome::RetryLater { .. } => {}
    }

    if let Some(spend) = spend_directive {
        steps.push(wallet_pay_step(spend));
    }

    steps.push(follow_up_step(request));

    steps
}

fn plan_summary_for(
    request: &PlanRequest,
    outcome: &DiscoveryOutcome,
    spend_directive: Option<&SpendDirective>,
) -> PlanSummary {
    let synopsis = match outcome {
        DiscoveryOutcome::Found(resolution) => {
            let primary = &resolution.primary;
            let alt_note = match resolution.alternatives.len() {
                0 => String::new(),
                count => format!(" ({} alternatives cached)", count),
            };
            format!(
                "Discovered {} capability for {}{}",
                strategy_label(primary.strategy),
                request.subject_id,
                alt_note
            )
        }
        DiscoveryOutcome::NotFound => {
            format!("Falling back to automation for {}", request.subject_id)
        }
        DiscoveryOutcome::RetryLater { .. } => "Discovery deferred".to_string(),
    };

    let synopsis = if let Some(spend) = spend_directive {
        format!("{synopsis}; collect authorized spend in {}", spend.currency)
    } else {
        synopsis
    };

    PlanSummary {
        synopsis: Some(synopsis),
    }
}

fn research_step() -> ActionPrimitive {
    let mut research_args = JsonMap::new();
    research_args.insert(
        "intent".to_string(),
        Value::String("collect_clarifying_details".into()),
    );
    research_args.insert(
        "notes".to_string(),
        Value::String("Review memory and prior commitments".into()),
    );

    ActionPrimitive::new(ActionPrimitiveKind::Research, research_args)
}

fn discovered_execution_step(resolution: &DiscoveryResolution) -> ActionPrimitive {
    let primary = &resolution.primary;

    let mut args = JsonMap::new();
    args.insert(
        "executor".to_string(),
        Value::String(executor_label(primary.strategy).into()),
    );
    args.insert(
        "locator".to_string(),
        Value::String(primary.locator.clone()),
    );
    args.insert("rank".to_string(), json!(primary.rank));
    args.insert(
        "intent".to_string(),
        Value::String("execute_discovered_capability".into()),
    );

    if !resolution.alternatives.is_empty() {
        let alternatives = resolution
            .alternatives
            .iter()
            .map(|alt| {
                json!({
                    "strategy": strategy_label(alt.strategy),
                    "locator": alt.locator,
                    "rank": alt.rank,
                })
            })
            .collect::<Vec<_>>();
        args.insert("alternatives".to_string(), Value::Array(alternatives));
    }

    ActionPrimitive::new(ActionPrimitiveKind::Http, args).with_postcondition(json!({
        "assertions": [
            { "type": "http_status", "equals": 200 }
        ],
        "metadata": {
            "status": "completed",
            "strategy": strategy_label(primary.strategy),
            "rank": primary.rank,
        }
    }))
}

fn fallback_execution_step() -> ActionPrimitive {
    let mut args = JsonMap::new();
    args.insert("executor".to_string(), Value::String("generic-web".into()));
    args.insert(
        "intent".to_string(),
        Value::String("fallback_automation".into()),
    );

    ActionPrimitive::new(ActionPrimitiveKind::Web, args).with_postcondition(json!({
        "assertions": [
            { "type": "dom_contains", "text": "<" }
        ],
        "metadata": {
            "status": "completed",
            "executor": "generic-web",
        }
    }))
}

fn follow_up_step(request: &PlanRequest) -> ActionPrimitive {
    let mut message_args = JsonMap::new();
    message_args.insert("channel".to_string(), Value::String("internal".into()));
    message_args.insert(
        "body".to_string(),
        Value::String(format!(
            "Summarize discovery path for subject {}",
            request.subject_id
        )),
    );

    ActionPrimitive::new(ActionPrimitiveKind::Message, message_args).with_postcondition(json!({
        "status": "queued"
    }))
}

#[derive(Clone, Debug)]
struct SpendDirective {
    amount_minor_units: u64,
    currency: String,
    merchant: Option<String>,
}

fn extract_spend_directive(request: &PlanRequest) -> Option<SpendDirective> {
    request
        .tags
        .iter()
        .find_map(|tag| parse_spend_tag(tag.as_str()))
}

fn parse_spend_tag(tag: &str) -> Option<SpendDirective> {
    let remainder = tag.strip_prefix("spend:")?;
    let mut parts = remainder.split(':');

    let amount_str = parts.next()?;
    let currency = parts.next()?.to_uppercase();
    let amount_minor_units = amount_str.parse::<u64>().ok()?;
    let merchant_raw = parts.next();
    let merchant = merchant_raw
        .map(|value| value.replace('_', " "))
        .filter(|value| !value.is_empty());

    Some(SpendDirective {
        amount_minor_units,
        currency,
        merchant,
    })
}

fn wallet_pay_step(directive: &SpendDirective) -> ActionPrimitive {
    let mut args = JsonMap::new();
    args.insert(
        "amount_minor_units".to_string(),
        json!(directive.amount_minor_units),
    );
    args.insert("currency".to_string(), json!(directive.currency));

    if let Some(merchant) = &directive.merchant {
        args.insert("merchant".to_string(), json!(merchant));
    }

    ActionPrimitive::new(ActionPrimitiveKind::Pay, args).with_postcondition(json!({
        "status": "authorized",
        "provider": "wallet_stub",
    }))
}

#[derive(Clone, Debug)]
struct SpendRequest {
    step_index: usize,
    amount_minor_units: u64,
    currency: String,
    merchant: Option<String>,
}

fn first_spend_request(steps: &[ActionPrimitive]) -> Option<SpendRequest> {
    steps.iter().enumerate().find_map(|(idx, step)| {
        if step.kind != ActionPrimitiveKind::Pay {
            return None;
        }

        let amount_minor_units = step
            .args
            .get("amount_minor_units")
            .and_then(Value::as_u64)?;
        let currency = step
            .args
            .get("currency")
            .and_then(Value::as_str)?
            .to_string();
        let merchant = step
            .args
            .get("merchant")
            .and_then(Value::as_str)
            .map(|value| value.to_string());

        Some(SpendRequest {
            step_index: idx,
            amount_minor_units,
            currency,
            merchant,
        })
    })
}

fn classify_plan_risk(
    classifier: &RiskClassifier,
    request: &PlanRequest,
    directive: Option<&SpendDirective>,
    outcome: &PlanOutcome,
) -> RiskVerdict {
    let input = RiskInput {
        tags: request.tags.clone(),
        spend: spend_context_from_outcome(outcome)
            .or_else(|| directive.map(directive_to_spend_context)),
    };

    classifier.classify(&input)
}

fn spend_context_from_outcome(outcome: &PlanOutcome) -> Option<SpendContext> {
    match outcome {
        PlanOutcome::Success { steps, .. } => {
            first_spend_request(steps).map(spend_request_to_context)
        }
        PlanOutcome::Escalate { escalation } => pay_step_to_spend(&escalation.action),
        PlanOutcome::Failure { .. } => None,
    }
}

fn pay_step_to_spend(step: &ActionPrimitive) -> Option<SpendContext> {
    if step.kind != ActionPrimitiveKind::Pay {
        return None;
    }

    let amount_minor_units = step
        .args
        .get("amount_minor_units")
        .and_then(Value::as_u64)?;
    let currency = step
        .args
        .get("currency")
        .and_then(Value::as_str)?
        .to_string();
    let merchant = step
        .args
        .get("merchant")
        .and_then(Value::as_str)
        .map(|value| value.to_string());

    Some(SpendContext {
        amount_minor_units,
        currency,
        merchant,
    })
}

fn spend_request_to_context(request: SpendRequest) -> SpendContext {
    SpendContext {
        amount_minor_units: request.amount_minor_units,
        currency: request.currency,
        merchant: request.merchant,
    }
}

fn directive_to_spend_context(directive: &SpendDirective) -> SpendContext {
    SpendContext {
        amount_minor_units: directive.amount_minor_units,
        currency: directive.currency.clone(),
        merchant: directive.merchant.clone(),
    }
}

fn guardrail_message(reason: &str) -> String {
    if reason.is_empty() {
        WALLET_GUARDRAIL_NOTE.to_string()
    } else {
        format!("{reason}\n{WALLET_GUARDRAIL_NOTE}")
    }
}

fn build_wallet_escalation(step_index: usize, sanitized_reason: &str) -> PlanEscalation {
    let rationale = guardrail_message(sanitized_reason);
    let context = json!({
        "decision": "escalate",
        "reason": sanitized_reason,
        "note": WALLET_GUARDRAIL_NOTE,
    });

    let args = ActionArguments::from_iter([
        (
            "prompt".into(),
            json!("Confirm wallet spend before continuing execution."),
        ),
        ("context".into(), context),
    ]);

    PlanEscalation {
        step_index,
        action: ActionPrimitive::new(ActionPrimitiveKind::Confirm, args),
        rationale: Some(rationale),
        expires_at: None,
    }
}

fn build_wallet_denial_error(sanitized_reason: &str) -> PlanError {
    PlanError {
        code: PlanErrorCode::PolicyDenied,
        message: "Wallet authorization denied".into(),
        detail: Some(guardrail_message(sanitized_reason)),
        retryable: false,
    }
}

fn strategy_label(strategy: DiscoveryStrategy) -> &'static str {
    match strategy {
        DiscoveryStrategy::Mcp => "mcp",
        DiscoveryStrategy::StructuredApi => "structured_api",
        DiscoveryStrategy::GenericHttp => "generic_http",
    }
}

fn executor_label(strategy: DiscoveryStrategy) -> &'static str {
    match strategy {
        DiscoveryStrategy::Mcp => "discovered-mcp",
        DiscoveryStrategy::StructuredApi => "discovered-structured",
        DiscoveryStrategy::GenericHttp => "generic-http",
    }
}

#[derive(Serialize)]
struct PlannerDecisionAudit {
    plan_id: String,
    plan_uuid: Uuid,
    request: RedactedRequest,
    policy: PolicyAudit,
    discovery: DiscoveryAudit,
    wallet: WalletAudit,
    outcome: PlanOutcomeAudit,
}

impl PlannerDecisionAudit {
    #[allow(clippy::too_many_arguments)]
    fn new(
        plan_uuid: Uuid,
        plan_id: &str,
        request: &PlanRequest,
        policy: PolicyAudit,
        discovery: DiscoveryAudit,
        wallet: WalletAudit,
        outcome: &PlanOutcome,
        risk: Option<&RiskVerdict>,
    ) -> Self {
        Self {
            plan_id: plan_id.to_owned(),
            plan_uuid,
            request: RedactedRequest::from_plan_request(request),
            policy,
            discovery,
            wallet,
            outcome: PlanOutcomeAudit::from(outcome, risk),
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
            .map(PolicyRuleAudit::from_rule)
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
#[serde(tag = "status", rename_all = "snake_case")]
enum DiscoveryAudit {
    Resolved {
        primary: DiscoveryAuditConnector,
        alternatives: Vec<DiscoveryAuditConnector>,
    },
    NotFound,
    Deferred {
        retry_after_ms: Option<u64>,
    },
    Skipped,
}

impl DiscoveryAudit {
    fn from_outcome(outcome: &DiscoveryOutcome) -> Self {
        match outcome {
            DiscoveryOutcome::Found(resolution) => Self::Resolved {
                primary: DiscoveryAuditConnector::from_connector(&resolution.primary),
                alternatives: resolution
                    .alternatives
                    .iter()
                    .map(DiscoveryAuditConnector::from_connector)
                    .collect(),
            },
            DiscoveryOutcome::NotFound => Self::NotFound,
            DiscoveryOutcome::RetryLater { retry_after } => Self::Deferred {
                retry_after_ms: retry_after
                    .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)),
            },
        }
    }

    fn deferred(retry_after_ms: Option<u64>) -> Self {
        Self::Deferred { retry_after_ms }
    }

    fn skipped() -> Self {
        Self::Skipped
    }
}

#[derive(Serialize)]
struct DiscoveryAuditConnector {
    strategy: String,
    locator: String,
    rank: usize,
}

impl DiscoveryAuditConnector {
    fn from_connector(connector: &DiscoveryConnector) -> Self {
        Self {
            strategy: strategy_label(connector.strategy).into(),
            locator: connector.locator.clone(),
            rank: connector.rank,
        }
    }
}

#[derive(Serialize)]
struct PolicyRuleAudit {
    rule: String,
    outcome: String,
    detail: String,
}

impl PolicyRuleAudit {
    fn from_rule(rule: &PolicyRuleDecision) -> Self {
        Self {
            rule: format!("{:?}", rule.rule),
            outcome: format!("{:?}", rule.outcome),
            detail: sanitize_detail(&rule.detail),
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum WalletAudit {
    Evaluated {
        decision: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    Errored {
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Skipped,
}

impl WalletAudit {
    fn skipped() -> Self {
        Self::Skipped
    }

    fn evaluated(decision: AuthorizationDecision, reason: String) -> Self {
        Self::Evaluated {
            decision: format!("{decision:?}"),
            reason: (!reason.is_empty()).then_some(reason),
        }
    }

    fn errored(error: String) -> Self {
        Self::Errored {
            error: (!error.is_empty()).then_some(error),
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum PlanOutcomeAudit {
    Success {
        step_count: usize,
        steps: Vec<LoggedStep>,
        summary_present: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        risk: Option<RiskVerdictAudit>,
    },
    Escalate {
        step_index: usize,
        action_kind: ActionPrimitiveKind,
        arg_keys: Vec<String>,
        rationale_present: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        risk: Option<RiskVerdictAudit>,
    },
    Failure {
        code: PlanErrorCode,
        retryable: bool,
        detail: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        risk: Option<RiskVerdictAudit>,
    },
}

impl PlanOutcomeAudit {
    fn from(outcome: &PlanOutcome, risk: Option<&RiskVerdict>) -> Self {
        match outcome {
            PlanOutcome::Success { steps, summary } => Self::Success {
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
                risk: map_risk_verdict(risk),
            },
            PlanOutcome::Escalate { escalation } => Self::Escalate {
                step_index: escalation.step_index,
                action_kind: escalation.action.kind,
                arg_keys: escalation.action.args.keys().cloned().collect(),
                rationale_present: escalation
                    .rationale
                    .as_ref()
                    .is_some_and(|value| !value.is_empty()),
                risk: map_risk_verdict(risk),
            },
            PlanOutcome::Failure { error } => Self::Failure {
                code: error.code,
                retryable: error.retryable,
                detail: error
                    .detail
                    .as_ref()
                    .map(|value| sanitize_detail(value))
                    .filter(|value| !value.is_empty()),
                risk: map_risk_verdict(risk),
            },
        }
    }
}

#[derive(Serialize)]
struct RiskVerdictAudit {
    level: RiskLevel,
    confidence: f32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    reasons: Vec<String>,
}

impl From<&RiskVerdict> for RiskVerdictAudit {
    fn from(value: &RiskVerdict) -> Self {
        let reasons = value
            .reasons
            .iter()
            .map(|reason| sanitize_detail(reason))
            .filter(|reason| !reason.is_empty())
            .collect();

        Self {
            level: value.level,
            confidence: (value.confidence * 100.0).round() / 100.0,
            reasons,
        }
    }
}

fn map_risk_verdict(risk: Option<&RiskVerdict>) -> Option<RiskVerdictAudit> {
    risk.map(RiskVerdictAudit::from)
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

fn sanitize_detail(detail: &str) -> String {
    // Replace numeric characters to avoid leaking precise spend thresholds in audit logs.
    detail
        .chars()
        .map(|character| {
            if character.is_ascii_digit() {
                '*'
            } else {
                character
            }
        })
        .collect()
}
