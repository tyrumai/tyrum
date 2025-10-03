use axum::{
    Json, Router,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

pub const DEFAULT_BIND_ADDR: &str = "0.0.0.0:8081";
const AUTO_APPROVE_LIMIT_MINOR: u64 = 10_000;
const HARD_DENY_LIMIT_MINOR: u64 = 50_000;

pub fn build_router() -> Router {
    Router::new()
        .route("/policy/check", post(policy_check))
        .route("/healthz", get(health))
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Approve,
    Escalate,
    Deny,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuleKind {
    SpendLimit,
    PiiGuardrail,
    LegalCompliance,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct RuleDecision {
    pub rule: RuleKind,
    pub outcome: Decision,
    pub detail: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct PolicyDecision {
    pub decision: Decision,
    pub rules: Vec<RuleDecision>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct PolicyCheckRequest {
    pub request_id: Option<String>,
    pub spend: Option<SpendContext>,
    pub pii: Option<PiiContext>,
    pub legal: Option<LegalContext>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SpendContext {
    pub amount_minor_units: u64,
    pub currency: String,
    #[serde(default)]
    pub user_limit_minor_units: Option<u64>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct PiiContext {
    pub categories: Vec<PiiCategory>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PiiCategory {
    BasicContact,
    Location,
    Financial,
    Health,
    Biometric,
    GovernmentId,
    #[serde(other)]
    Other,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct LegalContext {
    pub flags: Vec<LegalFlag>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LegalFlag {
    ProhibitedContent,
    RequiresReview,
    TermsUnknown,
    ExportControlled,
    #[serde(other)]
    Other,
}

async fn policy_check(Json(payload): Json<PolicyCheckRequest>) -> Json<PolicyDecision> {
    let spend_decision = evaluate_spend(payload.spend.as_ref());
    let pii_decision = evaluate_pii(payload.pii.as_ref());
    let legal_decision = evaluate_legal(payload.legal.as_ref());

    let rules = vec![spend_decision, pii_decision, legal_decision];
    let decision = overall_decision(&rules);

    Json(PolicyDecision { decision, rules })
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

fn overall_decision(rules: &[RuleDecision]) -> Decision {
    if rules.iter().any(|rule| rule.outcome == Decision::Deny) {
        Decision::Deny
    } else if rules.iter().any(|rule| rule.outcome == Decision::Escalate) {
        Decision::Escalate
    } else {
        Decision::Approve
    }
}

fn evaluate_spend(ctx: Option<&SpendContext>) -> RuleDecision {
    match ctx {
        None => RuleDecision {
            rule: RuleKind::SpendLimit,
            outcome: Decision::Escalate,
            detail: "Spend context missing; escalate for confirmation.".into(),
        },
        Some(ctx) => {
            let amount = ctx.amount_minor_units;
            let user_limit = ctx
                .user_limit_minor_units
                .unwrap_or(AUTO_APPROVE_LIMIT_MINOR);

            if amount > HARD_DENY_LIMIT_MINOR {
                RuleDecision {
                    rule: RuleKind::SpendLimit,
                    outcome: Decision::Deny,
                    detail: format!(
                        "Amount {} exceeds hard limit {}.",
                        format_money(amount, &ctx.currency),
                        format_money(HARD_DENY_LIMIT_MINOR, &ctx.currency)
                    ),
                }
            } else if amount > user_limit {
                RuleDecision {
                    rule: RuleKind::SpendLimit,
                    outcome: Decision::Escalate,
                    detail: format!(
                        "Amount {} exceeds user limit {}.",
                        format_money(amount, &ctx.currency),
                        format_money(user_limit, &ctx.currency)
                    ),
                }
            } else {
                RuleDecision {
                    rule: RuleKind::SpendLimit,
                    outcome: Decision::Approve,
                    detail: format!(
                        "Amount {} within auto-approval limit {}.",
                        format_money(amount, &ctx.currency),
                        format_money(user_limit, &ctx.currency)
                    ),
                }
            }
        }
    }
}

fn evaluate_pii(ctx: Option<&PiiContext>) -> RuleDecision {
    match ctx {
        None => RuleDecision {
            rule: RuleKind::PiiGuardrail,
            outcome: Decision::Escalate,
            detail: "PII context missing; escalate to request confirmation.".into(),
        },
        Some(ctx) => {
            if ctx.categories.is_empty() {
                return RuleDecision {
                    rule: RuleKind::PiiGuardrail,
                    outcome: Decision::Approve,
                    detail: "No PII categories declared.".into(),
                };
            }

            if ctx.categories.iter().any(|category| {
                matches!(category, PiiCategory::Biometric | PiiCategory::GovernmentId)
            }) {
                RuleDecision {
                    rule: RuleKind::PiiGuardrail,
                    outcome: Decision::Deny,
                    detail: format!(
                        "Detected protected PII categories: {}.",
                        describe_categories(&ctx.categories)
                    ),
                }
            } else if ctx
                .categories
                .iter()
                .any(|category| matches!(category, PiiCategory::Financial | PiiCategory::Health))
            {
                RuleDecision {
                    rule: RuleKind::PiiGuardrail,
                    outcome: Decision::Escalate,
                    detail: format!(
                        "Detected sensitive PII categories requiring consent: {}.",
                        describe_categories(&ctx.categories)
                    ),
                }
            } else {
                RuleDecision {
                    rule: RuleKind::PiiGuardrail,
                    outcome: Decision::Approve,
                    detail: format!(
                        "PII categories acceptable for automated handling: {}.",
                        describe_categories(&ctx.categories)
                    ),
                }
            }
        }
    }
}

fn evaluate_legal(ctx: Option<&LegalContext>) -> RuleDecision {
    match ctx {
        None => RuleDecision {
            rule: RuleKind::LegalCompliance,
            outcome: Decision::Escalate,
            detail: "Legal context missing; escalate for review.".into(),
        },
        Some(ctx) => {
            if ctx.flags.is_empty() {
                return RuleDecision {
                    rule: RuleKind::LegalCompliance,
                    outcome: Decision::Approve,
                    detail: "No legal flags raised.".into(),
                };
            }

            if ctx
                .flags
                .iter()
                .any(|flag| matches!(flag, LegalFlag::ProhibitedContent))
            {
                RuleDecision {
                    rule: RuleKind::LegalCompliance,
                    outcome: Decision::Deny,
                    detail: format!(
                        "Prohibited legal flags present: {}.",
                        describe_legal_flags(&ctx.flags)
                    ),
                }
            } else if ctx.flags.iter().any(|flag| {
                matches!(
                    flag,
                    LegalFlag::RequiresReview
                        | LegalFlag::ExportControlled
                        | LegalFlag::TermsUnknown
                )
            }) {
                RuleDecision {
                    rule: RuleKind::LegalCompliance,
                    outcome: Decision::Escalate,
                    detail: format!(
                        "Legal flags require human review: {}.",
                        describe_legal_flags(&ctx.flags)
                    ),
                }
            } else {
                RuleDecision {
                    rule: RuleKind::LegalCompliance,
                    outcome: Decision::Approve,
                    detail: format!(
                        "Legal flags acceptable: {}.",
                        describe_legal_flags(&ctx.flags)
                    ),
                }
            }
        }
    }
}

fn describe_categories(categories: &[PiiCategory]) -> String {
    categories
        .iter()
        .map(|category| match category {
            PiiCategory::BasicContact => "basic_contact",
            PiiCategory::Location => "location",
            PiiCategory::Financial => "financial",
            PiiCategory::Health => "health",
            PiiCategory::Biometric => "biometric",
            PiiCategory::GovernmentId => "government_id",
            PiiCategory::Other => "other",
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn describe_legal_flags(flags: &[LegalFlag]) -> String {
    flags
        .iter()
        .map(|flag| match flag {
            LegalFlag::ProhibitedContent => "prohibited_content",
            LegalFlag::RequiresReview => "requires_review",
            LegalFlag::TermsUnknown => "terms_unknown",
            LegalFlag::ExportControlled => "export_controlled",
            LegalFlag::Other => "other",
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_money(amount_minor: u64, currency: &str) -> String {
    let major = amount_minor as f64 / 100.0;
    format!("{} {:.2}", currency, major)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use serde_json::json;
    use tower::ServiceExt;

    #[test]
    fn spend_rule_auto_approves_within_limit() {
        let decision = evaluate_spend(Some(&SpendContext {
            amount_minor_units: 8_000,
            currency: "EUR".into(),
            user_limit_minor_units: None,
        }));
        assert_eq!(decision.outcome, Decision::Approve);
    }

    #[test]
    fn spend_rule_escalates_above_user_limit() {
        let decision = evaluate_spend(Some(&SpendContext {
            amount_minor_units: 15_000,
            currency: "EUR".into(),
            user_limit_minor_units: Some(12_000),
        }));
        assert_eq!(decision.outcome, Decision::Escalate);
    }

    #[test]
    fn spend_rule_denies_above_hard_limit() {
        let decision = evaluate_spend(Some(&SpendContext {
            amount_minor_units: 60_000,
            currency: "EUR".into(),
            user_limit_minor_units: Some(80_000),
        }));
        assert_eq!(decision.outcome, Decision::Deny);
    }

    #[test]
    fn pii_rule_approves_for_basic_contact() {
        let decision = evaluate_pii(Some(&PiiContext {
            categories: vec![PiiCategory::BasicContact],
        }));
        assert_eq!(decision.outcome, Decision::Approve);
    }

    #[test]
    fn pii_rule_escalates_for_financial_data() {
        let decision = evaluate_pii(Some(&PiiContext {
            categories: vec![PiiCategory::Financial],
        }));
        assert_eq!(decision.outcome, Decision::Escalate);
    }

    #[test]
    fn pii_rule_denies_for_biometric_data() {
        let decision = evaluate_pii(Some(&PiiContext {
            categories: vec![PiiCategory::Biometric],
        }));
        assert_eq!(decision.outcome, Decision::Deny);
    }

    #[test]
    fn legal_rule_approves_without_flags() {
        let decision = evaluate_legal(Some(&LegalContext { flags: vec![] }));
        assert_eq!(decision.outcome, Decision::Approve);
    }

    #[test]
    fn legal_rule_escalates_for_review_flag() {
        let decision = evaluate_legal(Some(&LegalContext {
            flags: vec![LegalFlag::RequiresReview],
        }));
        assert_eq!(decision.outcome, Decision::Escalate);
    }

    #[test]
    fn legal_rule_denies_for_prohibited_content() {
        let decision = evaluate_legal(Some(&LegalContext {
            flags: vec![LegalFlag::ProhibitedContent],
        }));
        assert_eq!(decision.outcome, Decision::Deny);
    }

    #[tokio::test]
    async fn endpoint_returns_overall_approval() {
        let app = build_router();
        let payload = json!({
            "request_id": "req-1",
            "spend": {
                "amount_minor_units": 8_000,
                "currency": "USD"
            },
            "pii": {
                "categories": ["basic_contact"]
            },
            "legal": {
                "flags": []
            }
        });
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/policy/check")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let decision: PolicyDecision = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decision.decision, Decision::Approve);
    }

    #[tokio::test]
    async fn endpoint_returns_overall_escalation_when_any_rule_escalates() {
        let app = build_router();
        let payload = json!({
            "spend": {
                "amount_minor_units": 15_000,
                "currency": "USD",
                "user_limit_minor_units": 12_000
            },
            "pii": {
                "categories": ["basic_contact"]
            },
            "legal": {
                "flags": []
            }
        });
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/policy/check")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let decision: PolicyDecision = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decision.decision, Decision::Escalate);
    }

    #[tokio::test]
    async fn endpoint_returns_overall_denial_when_any_rule_denies() {
        let app = build_router();
        let payload = json!({
            "spend": {
                "amount_minor_units": 5_000,
                "currency": "USD"
            },
            "pii": {
                "categories": ["biometric"]
            },
            "legal": {
                "flags": []
            }
        });
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/policy/check")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let decision: PolicyDecision = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decision.decision, Decision::Deny);
    }

    #[tokio::test]
    async fn health_endpoint_returns_ok() {
        let app = build_router();
        let response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let payload: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(payload, json!({"status": "ok"}));
    }
}
