use axum::{
    Json, Router,
    http::StatusCode,
    routing::{get, post},
};
use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;
use tyrum_shared::PamProfileRef;

pub mod telemetry;

pub const DEFAULT_BIND_ADDR: &str = "0.0.0.0:8081";
const AUTO_APPROVE_LIMIT_MINOR: u64 = 10_000;
const HARD_DENY_LIMIT_MINOR: u64 = 50_000;
const MAX_USER_IDENTIFIER_LEN: usize = 128;
const MAX_PAM_PROFILE_LEN: usize = 64;
const MAX_PAM_VERSION_LEN: usize = 32;
const AUTO_APPROVE_SCOPES: &[&str] = &[
    "mcp://calendar",
    "mcp://crm",
    "mcp://email",
    "mcp://files",
    "mcp://support",
    "mcp://tasks",
];
const HARD_DENY_SCOPES: &[&str] = &["mcp://root", "mcp://secrets", "mcp://admin"];

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
    ConnectorScope,
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
    #[serde(default, deserialize_with = "deserialize_trimmed_option_string")]
    pub user_id: Option<String>,
    #[serde(default)]
    pub pam_profile: Option<PamProfileRef>,
    pub spend: Option<SpendContext>,
    pub pii: Option<PiiContext>,
    pub legal: Option<LegalContext>,
    #[serde(default)]
    pub connector: Option<ConnectorScopeContext>,
}

impl PolicyCheckRequest {
    fn validate(&self) -> Result<(), RequestValidationError> {
        let user_id = match self.user_id.as_ref().filter(|value| !value.is_empty()) {
            Some(value) => value,
            None => return Err(RequestValidationError::MissingUserId),
        };

        if !is_valid_identifier(user_id, MAX_USER_IDENTIFIER_LEN) {
            return Err(RequestValidationError::UserId);
        }

        if let Some(profile) = &self.pam_profile {
            if !is_valid_identifier(&profile.profile_id, MAX_PAM_PROFILE_LEN) {
                return Err(RequestValidationError::PamProfileId);
            }

            if let Some(version) = profile.version.as_ref()
                && !is_valid_identifier(version, MAX_PAM_VERSION_LEN)
            {
                return Err(RequestValidationError::PamProfileVersion);
            }
        }

        Ok(())
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ConnectorScopeContext {
    #[serde(default, deserialize_with = "deserialize_trimmed_option_string")]
    pub scope: Option<String>,
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

#[derive(Debug, Error, PartialEq, Eq)]
enum RequestValidationError {
    #[error("user_id is required for policy evaluation")]
    MissingUserId,
    #[error("user_id must contain 1-128 ASCII alphanumeric, hyphen, underscore, or dot characters")]
    UserId,
    #[error(
        "pam_profile.profile_id must contain 1-64 ASCII alphanumeric, hyphen, underscore, or dot characters"
    )]
    PamProfileId,
    #[error(
        "pam_profile.version must contain 1-32 ASCII alphanumeric, hyphen, underscore, or dot characters"
    )]
    PamProfileVersion,
}

#[derive(Clone, Copy, Debug, Serialize)]
struct ValidationErrorResponse {
    error: &'static str,
    message: &'static str,
}

impl From<RequestValidationError> for ValidationErrorResponse {
    fn from(error: RequestValidationError) -> Self {
        match error {
            RequestValidationError::MissingUserId => Self {
                error: "missing_user_id",
                message: "user_id is required for policy evaluation",
            },
            RequestValidationError::UserId => Self {
                error: "invalid_user_id",
                message: "user_id must contain 1-128 ASCII alphanumeric, hyphen, underscore, or dot characters",
            },
            RequestValidationError::PamProfileId => Self {
                error: "invalid_pam_profile_id",
                message: "pam_profile.profile_id must contain 1-64 ASCII alphanumeric, hyphen, underscore, or dot characters",
            },
            RequestValidationError::PamProfileVersion => Self {
                error: "invalid_pam_profile_version",
                message: "pam_profile.version must contain 1-32 ASCII alphanumeric, hyphen, underscore, or dot characters",
            },
        }
    }
}

fn deserialize_trimmed_option_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let option = Option::<String>::deserialize(deserializer)?;
    Ok(option.map(|value| value.trim().to_owned()))
}

fn is_valid_identifier(value: &str, max_len: usize) -> bool {
    if value.is_empty() || value.len() > max_len {
        return false;
    }

    value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

#[tracing::instrument(skip(payload), name = "policy.check")]
async fn policy_check(
    Json(payload): Json<PolicyCheckRequest>,
) -> Result<Json<PolicyDecision>, (StatusCode, Json<ValidationErrorResponse>)> {
    if let Err(error) = payload.validate() {
        tracing::warn!(%error, "rejecting policy request due to invalid user context");
        return Err((StatusCode::BAD_REQUEST, Json(error.into())));
    }

    let spend_decision = evaluate_spend(payload.spend.as_ref());
    let pii_decision = evaluate_pii(payload.pii.as_ref());
    let legal_decision = evaluate_legal(payload.legal.as_ref());
    let connector_decision = evaluate_connector_scope(payload.connector.as_ref());

    let mut rules = vec![spend_decision, pii_decision, legal_decision];
    if let Some(rule) = connector_decision {
        rules.push(rule);
    }
    let decision = overall_decision(&rules);

    telemetry::record_policy_decision(decision);

    Ok(Json(PolicyDecision { decision, rules }))
}

#[tracing::instrument(name = "policy.health", skip_all)]
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

fn evaluate_connector_scope(ctx: Option<&ConnectorScopeContext>) -> Option<RuleDecision> {
    let ctx = ctx?;
    let scope = match ctx.scope.as_ref().filter(|value| !value.is_empty()) {
        Some(scope) => scope.as_str(),
        None => {
            return Some(RuleDecision {
                rule: RuleKind::ConnectorScope,
                outcome: Decision::Escalate,
                detail: "Connector scope missing; escalate for consent.".into(),
            });
        }
    };

    if HARD_DENY_SCOPES.contains(&scope) {
        Some(RuleDecision {
            rule: RuleKind::ConnectorScope,
            outcome: Decision::Deny,
            detail: format!("Connector scope {scope} prohibited by policy."),
        })
    } else if AUTO_APPROVE_SCOPES.contains(&scope) {
        Some(RuleDecision {
            rule: RuleKind::ConnectorScope,
            outcome: Decision::Approve,
            detail: format!("Connector scope {scope} already granted."),
        })
    } else {
        Some(RuleDecision {
            rule: RuleKind::ConnectorScope,
            outcome: Decision::Escalate,
            detail: format!("Consent required before activating connector scope {scope}."),
        })
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
    let decimals = currency_minor_units(currency).unwrap_or(2);
    let divisor = 10u64.saturating_pow(decimals);
    let major = amount_minor as f64 / divisor as f64;
    format!("{} {:.*}", currency, decimals as usize, major)
}

fn currency_minor_units(currency: &str) -> Option<u32> {
    match currency.to_ascii_uppercase().as_str() {
        // Zero-decimal ISO-4217 currencies
        "BIF" | "CLP" | "DJF" | "GNF" | "JPY" | "KMF" | "KRW" | "MGA" | "PYG" | "RWF" | "UGX"
        | "VND" | "VUV" | "XAF" | "XOF" | "XPF" => Some(0),
        // Three-decimal currencies
        "BHD" | "IQD" | "JOD" | "KWD" | "LYD" | "OMR" | "TND" => Some(3),
        // Common two-decimal currencies
        _ => Some(2),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]

    use super::*;
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use serde_json::json;
    use tower::ServiceExt;

    const WITH_USER_FIXTURE: &str = include_str!("../tests/fixtures/policy_check_with_user.json");
    const WITHOUT_USER_FIXTURE: &str =
        include_str!("../tests/fixtures/policy_check_without_user.json");

    #[test]
    fn fixture_with_user_context_parses_and_validates() {
        let request: PolicyCheckRequest =
            serde_json::from_str(WITH_USER_FIXTURE).expect("parse fixture");
        assert_eq!(request.user_id.as_deref(), Some("subject-123"));
        let profile = request.pam_profile.as_ref().expect("pam profile");
        assert_eq!(profile.profile_id, "pam-default");
        assert_eq!(profile.version.as_deref(), Some("v1"));
        request.validate().expect("fixture validates");
    }

    #[test]
    fn fixture_without_user_context_fails_validation() {
        let request: PolicyCheckRequest =
            serde_json::from_str(WITHOUT_USER_FIXTURE).expect("parse fixture");
        assert!(request.user_id.is_none());
        assert!(request.pam_profile.is_none());
        let error = request.validate().expect_err("validation should fail");
        assert_eq!(error, RequestValidationError::MissingUserId);
    }

    #[test]
    fn validation_rejects_blank_user_id() {
        let request: PolicyCheckRequest = serde_json::from_value(json!({
            "user_id": "   ",
        }))
        .expect("parse payload");

        let error = request.validate().expect_err("blank user id rejected");
        assert_eq!(error, RequestValidationError::MissingUserId);
    }

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

    #[test]
    fn connector_rule_approves_whitelisted_scope() {
        let decision = evaluate_connector_scope(Some(&ConnectorScopeContext {
            scope: Some("mcp://calendar".into()),
        }))
        .expect("decision");
        assert_eq!(decision.outcome, Decision::Approve);
    }

    #[test]
    fn connector_rule_escalates_for_unknown_scope() {
        let decision = evaluate_connector_scope(Some(&ConnectorScopeContext {
            scope: Some("mcp://analytics".into()),
        }))
        .expect("decision");
        assert_eq!(decision.outcome, Decision::Escalate);
    }

    #[test]
    fn connector_rule_denies_for_blocked_scope() {
        let decision = evaluate_connector_scope(Some(&ConnectorScopeContext {
            scope: Some("mcp://secrets".into()),
        }))
        .expect("decision");
        assert_eq!(decision.outcome, Decision::Deny);
    }

    #[test]
    fn connector_rule_escalates_when_scope_missing() {
        let decision = evaluate_connector_scope(Some(&ConnectorScopeContext { scope: None }))
            .expect("decision");
        assert_eq!(decision.outcome, Decision::Escalate);
    }

    #[tokio::test]
    async fn policy_check_rejects_invalid_user_id() {
        let app = build_router();
        let payload = json!({
            "user_id": "subject invalid",
            "pam_profile": {
                "profile_id": "pam-default"
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

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["error"], "invalid_user_id");
    }

    #[tokio::test]
    async fn policy_check_rejects_invalid_pam_profile() {
        let app = build_router();
        let payload = json!({
            "user_id": "subject-987",
            "pam_profile": {
                "profile_id": "pam default",
                "version": "v1"
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

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["error"], "invalid_pam_profile_id");
    }

    #[tokio::test]
    async fn policy_check_rejects_blank_user_id() {
        let app = build_router();
        let payload = json!({
            "user_id": "  ",
            "pam_profile": {
                "profile_id": "pam-default"
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

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["error"], "missing_user_id");
    }

    #[tokio::test]
    async fn policy_check_rejects_missing_user_id() {
        let app = build_router();
        let payload = json!({
            "pam_profile": {
                "profile_id": "pam-default"
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

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["error"], "missing_user_id");
    }

    #[tokio::test]
    async fn endpoint_returns_overall_approval() {
        let app = build_router();
        let payload = json!({
            "user_id": "subject-approval",
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
            "user_id": "subject-escalate",
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
            "user_id": "subject-deny",
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

    #[test]
    fn format_money_respects_zero_decimal_currency() {
        assert_eq!(format_money(1_234, "JPY"), "JPY 1234");
    }

    #[test]
    fn format_money_respects_three_decimal_currency() {
        assert_eq!(format_money(12_345, "BHD"), "BHD 12.345");
    }
}
