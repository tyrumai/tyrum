use std::{env, sync::Arc};

use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

pub mod telemetry;

pub const DEFAULT_BIND_ADDR: &str = "0.0.0.0:8084";
const DEFAULT_AUTO_APPROVE_LIMIT_MINOR: u64 = 10_000;
const DEFAULT_HARD_DENY_LIMIT_MINOR: u64 = 50_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Thresholds {
    pub auto_approve_minor_units: u64,
    pub hard_deny_minor_units: u64,
}

impl Thresholds {
    pub fn from_env() -> Self {
        let auto = read_limit(
            "WALLET_AUTO_APPROVE_LIMIT_MINOR",
            DEFAULT_AUTO_APPROVE_LIMIT_MINOR,
        );
        let hard = read_limit(
            "WALLET_HARD_DENY_LIMIT_MINOR",
            DEFAULT_HARD_DENY_LIMIT_MINOR,
        );

        if hard < auto {
            tracing::warn!(
                hard,
                auto,
                "hard deny limit below auto-approve; using auto limit as hard limit"
            );
        }

        Self {
            auto_approve_minor_units: auto,
            hard_deny_minor_units: hard.max(auto),
        }
    }
}

fn read_limit(var: &str, default: u64) -> u64 {
    match env::var(var) {
        Ok(value) => match value.parse::<u64>() {
            Ok(parsed) => parsed,
            Err(error) => {
                tracing::warn!(
                    limit_env = var,
                    %value,
                    %error,
                    "invalid wallet limit; using default"
                );
                default
            }
        },
        Err(_) => default,
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpendAuthorizeRequest {
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub card_id: Option<String>,
    pub amount_minor_units: u64,
    pub currency: String,
    #[serde(default)]
    pub merchant: Option<MerchantContext>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct MerchantContext {
    pub name: Option<String>,
    pub mcc: Option<String>,
    pub country: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthorizationDecision {
    Approve,
    Escalate,
    Deny,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct SpendAuthorizeResponse {
    pub request_id: Option<String>,
    pub decision: AuthorizationDecision,
    pub reason: String,
    pub limits: AuthorizationLimits,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct AuthorizationLimits {
    pub auto_approve_minor_units: u64,
    pub hard_deny_minor_units: u64,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
struct HealthResponse {
    status: &'static str,
}

pub type SharedThresholds = Arc<Thresholds>;

pub fn build_router(thresholds: Thresholds) -> Router<()> {
    Router::new()
        .route("/spend/authorize", post(authorize_spend))
        .route("/healthz", get(health))
        .with_state::<()>(Arc::new(thresholds))
}

pub fn authorize_with_thresholds(
    payload: SpendAuthorizeRequest,
    thresholds: Thresholds,
) -> SpendAuthorizeResponse {
    let SpendAuthorizeRequest {
        request_id,
        amount_minor_units,
        currency,
        ..
    } = payload;

    let EvaluatedAuthorization { decision, reason } =
        evaluate_amount(amount_minor_units, &currency, thresholds);

    SpendAuthorizeResponse {
        request_id,
        decision,
        reason,
        limits: AuthorizationLimits::from(thresholds),
    }
}

#[tracing::instrument(skip(payload))]
async fn authorize_spend(
    State(thresholds): State<SharedThresholds>,
    Json(payload): Json<SpendAuthorizeRequest>,
) -> Json<SpendAuthorizeResponse> {
    let thresholds = *thresholds;
    let response = authorize_with_thresholds(payload, thresholds);

    telemetry::record_authorization(response.decision);

    Json(response)
}

#[tracing::instrument(skip_all)]
async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

fn evaluate_amount(
    amount_minor_units: u64,
    currency: &str,
    thresholds: Thresholds,
) -> EvaluatedAuthorization {
    if amount_minor_units > thresholds.hard_deny_minor_units {
        EvaluatedAuthorization::new(
            AuthorizationDecision::Deny,
            format!(
                "Amount {} exceeds hard limit {}.",
                format_money(amount_minor_units, currency),
                format_money(thresholds.hard_deny_minor_units, currency)
            ),
        )
    } else if amount_minor_units > thresholds.auto_approve_minor_units {
        EvaluatedAuthorization::new(
            AuthorizationDecision::Escalate,
            format!(
                "Amount {} exceeds auto-approval limit {}; escalate to human review.",
                format_money(amount_minor_units, currency),
                format_money(thresholds.auto_approve_minor_units, currency)
            ),
        )
    } else {
        EvaluatedAuthorization::new(
            AuthorizationDecision::Approve,
            format!(
                "Amount {} within auto-approval limit {}.",
                format_money(amount_minor_units, currency),
                format_money(thresholds.auto_approve_minor_units, currency)
            ),
        )
    }
}

#[derive(Debug, PartialEq, Eq)]
struct EvaluatedAuthorization {
    decision: AuthorizationDecision,
    reason: String,
}

impl EvaluatedAuthorization {
    fn new(decision: AuthorizationDecision, reason: String) -> Self {
        Self { decision, reason }
    }
}

impl AuthorizationLimits {
    fn from(thresholds: Thresholds) -> Self {
        Self {
            auto_approve_minor_units: thresholds.auto_approve_minor_units,
            hard_deny_minor_units: thresholds.hard_deny_minor_units,
        }
    }
}

fn format_money(amount_minor: u64, currency: &str) -> String {
    let decimals = currency_minor_units(currency).unwrap_or(2);
    let divisor = 10u64.saturating_pow(decimals);
    let major = amount_minor as f64 / divisor as f64;
    format!(
        "{} {:.*}",
        currency.to_ascii_uppercase(),
        decimals as usize,
        major
    )
}

fn currency_minor_units(currency: &str) -> Option<u32> {
    match currency.to_ascii_uppercase().as_str() {
        "BIF" | "CLP" | "DJF" | "GNF" | "JPY" | "KMF" | "KRW" | "MGA" | "PYG" | "RWF" | "UGX"
        | "VND" | "VUV" | "XAF" | "XOF" | "XPF" => Some(0),
        "BHD" | "IQD" | "JOD" | "KWD" | "LYD" | "OMR" | "TND" => Some(3),
        _ => Some(2),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thresholds_default_to_expected_values() {
        let thresholds = Thresholds::from_env();
        assert_eq!(
            thresholds,
            Thresholds {
                auto_approve_minor_units: DEFAULT_AUTO_APPROVE_LIMIT_MINOR,
                hard_deny_minor_units: DEFAULT_HARD_DENY_LIMIT_MINOR
            }
        );
    }

    #[test]
    fn evaluate_amount_approves_within_limit() {
        let thresholds = Thresholds {
            auto_approve_minor_units: 10_000,
            hard_deny_minor_units: 50_000,
        };
        let result = evaluate_amount(7_500, "EUR", thresholds);
        assert_eq!(result.decision, AuthorizationDecision::Approve);
        assert!(
            result
                .reason
                .contains("within auto-approval limit EUR 100.00")
        );
    }

    #[test]
    fn evaluate_amount_escalates_above_auto_but_below_hard() {
        let thresholds = Thresholds {
            auto_approve_minor_units: 10_000,
            hard_deny_minor_units: 50_000,
        };
        let result = evaluate_amount(25_000, "EUR", thresholds);
        assert_eq!(result.decision, AuthorizationDecision::Escalate);
    }

    #[test]
    fn evaluate_amount_denies_above_hard_limit() {
        let thresholds = Thresholds {
            auto_approve_minor_units: 10_000,
            hard_deny_minor_units: 50_000,
        };
        let result = evaluate_amount(75_000, "EUR", thresholds);
        assert_eq!(result.decision, AuthorizationDecision::Deny);
    }

    #[test]
    fn authorize_helper_returns_expected_response() {
        let thresholds = Thresholds {
            auto_approve_minor_units: 10_000,
            hard_deny_minor_units: 50_000,
        };
        let payload = SpendAuthorizeRequest {
            request_id: Some("req-approve".into()),
            card_id: Some("card_123".into()),
            amount_minor_units: 7_500,
            currency: "eur".into(),
            merchant: Some(MerchantContext {
                name: Some("Example Shop".into()),
                mcc: None,
                country: None,
            }),
        };
        let response = authorize_with_thresholds(payload, thresholds);
        assert_eq!(response.decision, AuthorizationDecision::Approve);
        assert_eq!(
            response.reason,
            "Amount EUR 75.00 within auto-approval limit EUR 100.00."
        );
    }

    #[tokio::test]
    async fn health_endpoint_reports_ok() {
        let Json(payload) = health().await;
        assert_eq!(payload.status, "ok");
    }
}
