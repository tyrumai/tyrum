use axum::{Json, Router, extract::State, routing::post};
use serde::{Deserialize, Serialize};

use crate::{RiskClassifier, RiskInput, RiskLevel, RiskVerdict, SpendContext};

#[derive(Clone)]
struct AppState {
    classifier: RiskClassifier,
}

#[derive(Debug, Deserialize)]
struct RiskScoreRequest {
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    spend: Option<RequestSpend>,
}

#[derive(Debug, Deserialize)]
struct RequestSpend {
    amount_minor_units: u64,
    currency: String,
    #[serde(default)]
    merchant: Option<String>,
}

#[derive(Debug, Serialize)]
struct RiskScoreResponse {
    verdict: RiskLevel,
    confidence: f32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    reasons: Vec<String>,
}

impl From<RiskVerdict> for RiskScoreResponse {
    fn from(value: RiskVerdict) -> Self {
        Self {
            verdict: value.level,
            confidence: value.confidence,
            reasons: value.reasons,
        }
    }
}

pub fn router(classifier: RiskClassifier) -> Router {
    Router::new()
        .route("/risk/score", post(score))
        .with_state(AppState { classifier })
}

async fn score(
    State(state): State<AppState>,
    Json(payload): Json<RiskScoreRequest>,
) -> Json<RiskScoreResponse> {
    let input = RiskInput {
        tags: payload.tags,
        spend: payload.spend.map(|spend| SpendContext {
            amount_minor_units: spend.amount_minor_units,
            currency: spend.currency,
            merchant: spend.merchant,
        }),
    };

    Json(state.classifier.classify(&input).into())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]

    use super::*;
    use axum::{body::Body, http::Request};
    use serde_json::json;
    use tower::ServiceExt;

    #[tokio::test]
    async fn scores_payload() {
        let mut config = crate::RiskConfig::default();
        config.tag_weights.insert("risk:manual_review".into(), 0.4);
        let router = router(RiskClassifier::new(config));

        let payload = json!({
            "tags": ["risk:manual_review"],
        });

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/risk/score")
                    .method("POST")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("buffer");
        let body: serde_json::Value = serde_json::from_slice(&bytes).expect("json body");
        assert_eq!(
            body.get("verdict").and_then(|value| value.as_str()),
            Some("medium")
        );
    }
}
