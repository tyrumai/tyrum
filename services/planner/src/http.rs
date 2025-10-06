use axum::{
    Json, Router,
    http::StatusCode,
    routing::{get, post},
};
use chrono::Utc;
use serde::Serialize;
use serde_json::{Map as JsonMap, Value, json};
use tower_http::limit::RequestBodyLimitLayer;
use uuid::Uuid;

use crate::{
    ActionPrimitive, ActionPrimitiveKind, PlanOutcome, PlanRequest, PlanResponse, PlanSummary,
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

pub fn build_router() -> Router {
    Router::new()
        .route("/plan", post(plan))
        .route("/healthz", get(health))
        .layer(RequestBodyLimitLayer::new(MAX_PLAN_REQUEST_BYTES))
}

#[tracing::instrument(skip_all)]
async fn plan(
    Json(payload): Json<PlanRequest>,
) -> Result<Json<PlanResponse>, (StatusCode, Json<ValidationError>)> {
    tracing::debug!("TODO: add planner auth and policy enforcement");

    if payload.request_id.trim().is_empty() {
        return Err(bad_request("request_id must not be empty"));
    }

    if payload.subject_id.trim().is_empty() {
        return Err(bad_request("subject_id must not be empty"));
    }

    let response = PlanResponse {
        plan_id: format!("plan-{}", Uuid::new_v4().simple()),
        request_id: payload.request_id.clone(),
        created_at: Utc::now(),
        trace_id: Some(Uuid::new_v4().to_string()),
        outcome: PlanOutcome::Success {
            steps: stub_steps(),
            summary: PlanSummary {
                synopsis: Some(format!("Stub plan prepared for {}", payload.subject_id)),
            },
        },
    };

    Ok(Json(response))
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
