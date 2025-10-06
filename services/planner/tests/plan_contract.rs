use chrono::{DateTime, Utc};
use serde_json::json;
use tyrum_planner::{
    ActionArguments, ActionPrimitive, ActionPrimitiveKind, PlanError, PlanErrorCode,
    PlanEscalation, PlanOutcome, PlanResponse, PlanSummary,
};

fn parse_timestamp(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .expect("valid timestamp")
        .with_timezone(&Utc)
}

fn sample_success_response() -> PlanResponse {
    let mut args = ActionArguments::default();
    args.insert("intent".into(), json!("look_up_availability"));
    args.insert("query".into(), json!("espresso tasting"));
    let research = ActionPrimitive::new(ActionPrimitiveKind::Research, args);

    PlanResponse {
        plan_id: "plan-success".into(),
        request_id: "req-123".into(),
        created_at: parse_timestamp("2025-10-05T16:31:09Z"),
        trace_id: Some("trace-abc".into()),
        outcome: PlanOutcome::Success {
            steps: vec![research],
            summary: PlanSummary {
                synopsis: Some("Research espresso tasting slots".into()),
            },
        },
    }
}

#[test]
fn plan_contract_success_round_trip() {
    let response = sample_success_response();
    let json = serde_json::to_value(&response).expect("serialize success");
    assert_eq!(json["status"], "success");

    let round_trip: PlanResponse = serde_json::from_value(json).expect("deserialize success");
    assert_eq!(round_trip, response);
}

#[test]
fn plan_contract_escalate_round_trip() {
    let confirm = ActionPrimitive::new(
        ActionPrimitiveKind::Confirm,
        ActionArguments::from_iter([
            ("prompt".into(), json!("Approve €85 tasting fee?")),
            ("context".into(), json!({ "merchant": "EspressoExpress" })),
        ]),
    );

    let response = PlanResponse {
        plan_id: "plan-escalate".into(),
        request_id: "req-123".into(),
        created_at: parse_timestamp("2025-10-06T08:00:00Z"),
        trace_id: None,
        outcome: PlanOutcome::Escalate {
            escalation: PlanEscalation {
                step_index: 0,
                action: confirm,
                rationale: Some("Policy requires user confirmation".into()),
                expires_at: Some(parse_timestamp("2025-10-06T12:00:00Z")),
            },
        },
    };

    let json = serde_json::to_value(&response).expect("serialize escalate");
    assert_eq!(json["status"], "escalate");
    assert_eq!(json["escalation"]["action"]["type"], "Confirm");

    let round_trip: PlanResponse = serde_json::from_value(json).expect("deserialize");
    assert_eq!(round_trip, response);
}

#[test]
fn plan_contract_failure_round_trip() {
    let response = PlanResponse {
        plan_id: "plan-failure".into(),
        request_id: "req-123".into(),
        created_at: parse_timestamp("2025-10-07T09:15:00Z"),
        trace_id: Some("trace-xyz".into()),
        outcome: PlanOutcome::Failure {
            error: PlanError {
                code: PlanErrorCode::PolicyDenied,
                message: "Policy gate denied consent".into(),
                detail: Some("Spend cap exceeded".into()),
                retryable: false,
            },
        },
    };

    let json = serde_json::to_value(&response).expect("serialize failure");
    assert_eq!(json["status"], "failure");

    let round_trip: PlanResponse = serde_json::from_value(json).expect("deserialize failure");
    assert_eq!(round_trip, response);
}
