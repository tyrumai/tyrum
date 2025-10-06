use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value};

use crate::NormalizedThreadMessage;

/// Parameters passed to an [`ActionPrimitive`] invocation.
pub type ActionArguments = JsonMap<String, Value>;

/// Arbitrary predicate describing the evidence we expect after an action.
pub type ActionPostcondition = Value;

/// Neutral action representation exchanged between planner and executors.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionPrimitive {
    #[serde(rename = "type")]
    pub kind: ActionPrimitiveKind,
    #[serde(default)]
    pub args: ActionArguments,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub postcondition: Option<ActionPostcondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
}

impl ActionPrimitive {
    /// Construct a new primitive with the required `type` and `args` fields.
    pub fn new(kind: ActionPrimitiveKind, args: ActionArguments) -> Self {
        Self {
            kind,
            args,
            postcondition: None,
            idempotency_key: None,
        }
    }

    /// Attach an action postcondition, replacing any existing value.
    pub fn with_postcondition(mut self, postcondition: ActionPostcondition) -> Self {
        self.postcondition = Some(postcondition);
        self
    }

    /// Attach an idempotency key used by executors to dedupe retries.
    pub fn with_idempotency_key(mut self, idempotency_key: impl Into<String>) -> Self {
        self.idempotency_key = Some(idempotency_key.into());
        self
    }

    /// Returns `true` if this primitive requires a postcondition for safe execution.
    pub fn requires_postcondition(&self) -> bool {
        self.kind.requires_postcondition()
    }
}

/// Enumerates supported action primitive kinds.
#[allow(clippy::exhaustive_enums)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum ActionPrimitiveKind {
    Research,
    Decide,
    Web,
    Android,
    #[serde(rename = "CLI")]
    Cli,
    Http,
    Message,
    Pay,
    Store,
    Watch,
    Confirm,
}

impl ActionPrimitiveKind {
    /// Returns `true` when the primitive mutates external state and must assert a postcondition.
    pub fn requires_postcondition(self) -> bool {
        matches!(
            self,
            Self::Web
                | Self::Android
                | Self::Cli
                | Self::Http
                | Self::Message
                | Self::Pay
                | Self::Store
                | Self::Watch
        )
    }
}

/// Canonical request envelope accepted by the planner service.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanRequest {
    /// Unique identifier supplied by the caller for idempotency.
    pub request_id: String,
    /// Stable subject identifier for memory, policy, and wallet lookups.
    pub subject_id: String,
    /// Triggering ingress event (thread + message) that the plan responds to.
    pub trigger: NormalizedThreadMessage,
    /// Optional BCP-47 locale hint to shape prompts and output tone.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    /// Optional IANA time zone identifier used for scheduling and summarisation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    /// Arbitrary caller-provided tags applied to the resulting plan for analytics.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

/// Planner response envelope surfaced to upstream services.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanResponse {
    /// Stable identifier assigned by the planner to this plan.
    pub plan_id: String,
    /// Mirrors `PlanRequest::request_id` for dedupe and tracing.
    pub request_id: String,
    /// Timestamp when the planner produced the response.
    pub created_at: DateTime<Utc>,
    /// Optional distributed trace identifier for cross-service correlation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    /// Outcome payload describing success, escalation, or failure.
    #[serde(flatten)]
    pub outcome: PlanOutcome,
}

/// Result envelope describing the planner outcome.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PlanOutcome {
    /// Plan succeeded and contains executable steps.
    Success {
        /// Ordered list of action primitives comprising the plan.
        steps: Vec<ActionPrimitive>,
        /// Summary metadata for audit and client display. Clients should derive the
        /// step count from `steps.len()` to avoid mismatches.
        summary: PlanSummary,
    },
    /// Planner requires human input before proceeding.
    Escalate {
        /// Human escalation payload describing the pending confirm step.
        escalation: PlanEscalation,
    },
    /// Plan failed and surfaces a structured error payload.
    Failure {
        /// Error context categorising the failure and remediation guidance.
        error: PlanError,
    },
}

/// Success metadata summarising the generated plan.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanSummary {
    /// Optional natural-language synopsis of the proposed plan.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synopsis: Option<String>,
}

/// Escalation payload returned when the planner needs human confirmation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanEscalation {
    /// Index of the confirm step that is awaiting human input.
    pub step_index: usize,
    /// Action primitive describing the confirm request surface.
    pub action: ActionPrimitive,
    /// Optional rationale explaining why the planner paused for review.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rationale: Option<String>,
    /// Optional expiry timestamp after which the plan should be replayed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<DateTime<Utc>>,
}

/// Structured planner error surfaced to upstream services.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanError {
    /// Machine-readable error code for routing and observability.
    pub code: PlanErrorCode,
    /// Human-readable summary of the failure.
    pub message: String,
    /// Optional extended context used for troubleshooting.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Signals whether the caller may safely retry the request.
    #[serde(default)]
    pub retryable: bool,
}

/// Enumeration of canonical planner error codes.
#[allow(clippy::exhaustive_enums)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanErrorCode {
    InvalidRequest,
    PolicyDenied,
    ExecutorUnavailable,
    Internal,
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono::Utc;
    use serde_json::json;

    fn timestamp(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .expect("valid RFC3339 timestamp")
            .with_timezone(&Utc)
    }

    #[test]
    fn action_serde_round_trip_respects_schema() {
        let mut args = ActionArguments::default();
        args.insert("query".into(), Value::String("find coffees".into()));
        let primitive = ActionPrimitive::new(ActionPrimitiveKind::Research, args.clone())
            .with_idempotency_key("research-1");
        let json = serde_json::to_value(&primitive).expect("serialize primitive");
        assert_eq!(json["type"], "Research");
        assert_eq!(json["args"], Value::Object(args));
        assert!(json.get("postcondition").is_none());
        assert_eq!(json["idempotency_key"], "research-1");

        let restored: ActionPrimitive =
            serde_json::from_value(json).expect("deserialize primitive");
        assert_eq!(restored.kind, ActionPrimitiveKind::Research);
        assert_eq!(restored.args.get("query").unwrap(), "find coffees");
        assert_eq!(restored.idempotency_key.as_deref(), Some("research-1"));
    }

    #[test]
    fn mutating_primitives_require_postconditions() {
        for kind in [
            ActionPrimitiveKind::Web,
            ActionPrimitiveKind::Android,
            ActionPrimitiveKind::Cli,
            ActionPrimitiveKind::Http,
            ActionPrimitiveKind::Message,
            ActionPrimitiveKind::Pay,
            ActionPrimitiveKind::Store,
            ActionPrimitiveKind::Watch,
        ] {
            assert!(
                kind.requires_postcondition(),
                "{kind:?} should require postcondition"
            );
        }

        for kind in [
            ActionPrimitiveKind::Research,
            ActionPrimitiveKind::Decide,
            ActionPrimitiveKind::Confirm,
        ] {
            assert!(
                !kind.requires_postcondition(),
                "{kind:?} should not require postcondition"
            );
        }
    }

    #[test]
    fn plan_response_success_round_trips() {
        let mut args = ActionArguments::default();
        args.insert("intent".into(), json!("look_up"));
        args.insert("query".into(), json!("best espresso"));
        let step = ActionPrimitive::new(ActionPrimitiveKind::Research, args);

        let response = PlanResponse {
            plan_id: "plan-success".into(),
            request_id: "req-123".into(),
            created_at: timestamp("2025-10-05T16:31:09Z"),
            trace_id: Some("trace-abc".into()),
            outcome: PlanOutcome::Success {
                steps: vec![step.clone()],
                summary: PlanSummary {
                    synopsis: Some("Research best espresso options".into()),
                },
            },
        };

        let json = serde_json::to_value(&response).expect("serialize plan response");
        assert_eq!(json["status"], "success");
        assert_eq!(json["steps"].as_array().unwrap().len(), 1);

        let round_trip: PlanResponse = serde_json::from_value(json).expect("deserialize");
        assert_eq!(round_trip, response);
    }

    #[test]
    fn plan_response_escalate_round_trips() {
        let confirm = ActionPrimitive::new(
            ActionPrimitiveKind::Confirm,
            ActionArguments::from_iter([
                ("prompt".into(), json!("Proceed with booking?")),
                ("context".into(), json!({ "slot": "15:00Z" })),
            ]),
        );

        let response = PlanResponse {
            plan_id: "plan-escalate".into(),
            request_id: "req-esc".into(),
            created_at: timestamp("2025-10-06T08:00:00Z"),
            trace_id: None,
            outcome: PlanOutcome::Escalate {
                escalation: PlanEscalation {
                    step_index: 2,
                    action: confirm.clone(),
                    rationale: Some("Requires explicit approval".into()),
                    expires_at: Some(timestamp("2025-10-06T12:00:00Z")),
                },
            },
        };

        let json = serde_json::to_value(&response).expect("serialize plan response");
        assert_eq!(json["status"], "escalate");
        assert_eq!(json["escalation"]["step_index"], 2);
        assert_eq!(json["escalation"]["action"]["type"], "Confirm");

        let round_trip: PlanResponse = serde_json::from_value(json).expect("deserialize");
        assert_eq!(round_trip, response);
    }

    #[test]
    fn plan_response_failure_round_trips() {
        let response = PlanResponse {
            plan_id: "plan-failure".into(),
            request_id: "req-fail".into(),
            created_at: timestamp("2025-10-07T09:15:00Z"),
            trace_id: Some("trace-failure".into()),
            outcome: PlanOutcome::Failure {
                error: PlanError {
                    code: PlanErrorCode::PolicyDenied,
                    message: "Policy gate denied consent".into(),
                    detail: Some("Spend cap exceeded for wallet tyrum".into()),
                    retryable: false,
                },
            },
        };

        let json = serde_json::to_value(&response).expect("serialize plan response");
        assert_eq!(json["status"], "failure");
        assert_eq!(json["error"]["code"], "policy_denied");
        assert_eq!(json["error"]["retryable"], false);

        let round_trip: PlanResponse = serde_json::from_value(json).expect("deserialize");
        assert_eq!(round_trip, response);
    }
}
