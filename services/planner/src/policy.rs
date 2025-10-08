use std::collections::BTreeSet;

use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};

use crate::PlanRequest;

/// Thin async client for the policy check service.
#[derive(Clone)]
pub struct PolicyClient {
    http: Client,
    base_url: Url,
}

impl PolicyClient {
    /// Construct a policy client targeting the provided base URL.
    ///
    /// # Panics
    ///
    /// Panics if the underlying HTTP client cannot be constructed.
    #[must_use]
    pub fn new(base_url: Url) -> Self {
        let http = match Client::builder().user_agent("tyrum-planner").build() {
            Ok(client) => client,
            Err(err) => panic!("construct reqwest client: {err}"),
        };

        Self { http, base_url }
    }

    /// Execute a policy check for the supplied plan request.
    ///
    /// # Errors
    ///
    /// Returns a [`PolicyClientError`] when URL construction, transport, or decoding fails or
    /// when the policy gate returns a non-success HTTP status.
    pub async fn check(&self, request: &PlanRequest) -> Result<PolicyDecision, PolicyClientError> {
        let payload = PolicyCheckPayload::from_plan_request(request);
        let url = self
            .base_url
            .join("/policy/check")
            .map_err(|error| PolicyClientError::InvalidUrl { error })?;

        let response = self
            .http
            .post(url)
            .json(&payload)
            .send()
            .await
            .map_err(|error| PolicyClientError::Transport { error })?;

        if !response.status().is_success() {
            let status = response.status();
            return Err(PolicyClientError::UnexpectedStatus { status });
        }

        response
            .json::<PolicyDecision>()
            .await
            .map_err(|error| PolicyClientError::Decode { error })
    }
}

/// Errors surfaced when calling the policy gate.
#[derive(Debug, thiserror::Error)]
pub enum PolicyClientError {
    #[error("invalid policy URL: {error}")]
    InvalidUrl { error: url::ParseError },
    #[error("policy transport error: {error}")]
    Transport { error: reqwest::Error },
    #[error("policy returned unexpected status {status}")]
    UnexpectedStatus { status: StatusCode },
    #[error("failed to decode policy response: {error}")]
    Decode { error: reqwest::Error },
}

#[derive(Clone, Debug, Serialize, Default)]
struct PolicyCheckPayload {
    request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pam_profile: Option<tyrum_shared::planner::PamProfileRef>,
    spend: Option<SpendContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pii: Option<PiiContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    legal: Option<LegalContext>,
}

impl PolicyCheckPayload {
    fn from_plan_request(request: &PlanRequest) -> Self {
        let mut pii_categories: BTreeSet<PiiCategory> = BTreeSet::new();

        for field in &request.trigger.thread.pii_fields {
            if let Some(category) = PiiCategory::from_pii_field(*field) {
                pii_categories.insert(category);
            }
        }

        for field in &request.trigger.message.pii_fields {
            if let Some(category) = PiiCategory::from_pii_field(*field) {
                pii_categories.insert(category);
            }
        }

        let pii = if pii_categories.is_empty() {
            None
        } else {
            Some(PiiContext {
                categories: pii_categories.iter().copied().collect(),
            })
        };

        let (user_id, pam_profile) = match request.user.as_ref() {
            Some(context) => (Some(context.user_id.clone()), context.pam_profile.clone()),
            None => (Some(request.subject_id.clone()), None),
        };

        Self {
            request_id: Some(request.request_id.clone()),
            user_id,
            pam_profile,
            spend: None,
            pii,
            legal: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
struct SpendContext {
    amount_minor_units: u64,
    currency: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    user_limit_minor_units: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Default)]
struct PiiContext {
    #[serde(default)]
    categories: Vec<PiiCategory>,
}

#[derive(Clone, Debug, Serialize, Default)]
struct LegalContext {
    #[serde(default)]
    flags: Vec<LegalFlag>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
enum PiiCategory {
    BasicContact,
    Location,
    Financial,
    Health,
    Biometric,
    GovernmentId,
    Other,
}

impl PiiCategory {
    fn from_pii_field(field: tyrum_shared::PiiField) -> Option<Self> {
        use tyrum_shared::PiiField as Field;

        match field {
            Field::SenderFirstName
            | Field::SenderLastName
            | Field::SenderUsername
            | Field::ThreadUsername => Some(Self::BasicContact),
            Field::MessageText | Field::MessageCaption | Field::ThreadTitle => Some(Self::Other),
            Field::SenderLanguageCode => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum LegalFlag {
    ProhibitedContent,
    RequiresReview,
    TermsUnknown,
    ExportControlled,
    Other,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct PolicyDecision {
    pub decision: PolicyDecisionKind,
    pub rules: Vec<PolicyRuleDecision>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct PolicyRuleDecision {
    pub rule: PolicyRuleKind,
    pub outcome: PolicyDecisionKind,
    pub detail: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PolicyDecisionKind {
    Approve,
    Escalate,
    Deny,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PolicyRuleKind {
    SpendLimit,
    PiiGuardrail,
    LegalCompliance,
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]

    use super::*;

    use crate::PlanRequest;
    use axum::{Json, Router, routing::post};
    use chrono::Utc;
    use reqwest::Url;
    use serde_json::json;
    use tokio::{net::TcpListener, task::JoinHandle};
    use tyrum_shared::{
        MessageContent, MessageSource, NormalizedMessage, NormalizedThread,
        NormalizedThreadMessage, PamProfileRef, PiiField, PlanUserContext, SenderMetadata,
        ThreadKind,
    };

    fn sample_plan_request() -> PlanRequest {
        PlanRequest {
            request_id: "req-42".into(),
            subject_id: "subject-17".into(),
            user: Some(PlanUserContext {
                user_id: "subject-17".into(),
                pam_profile: Some(PamProfileRef {
                    profile_id: "pam-default".into(),
                    version: Some("v1".into()),
                }),
            }),
            trigger: NormalizedThreadMessage {
                thread: NormalizedThread {
                    id: "thread-1".into(),
                    kind: ThreadKind::Private,
                    title: Some("Planning".into()),
                    username: Some("alex".into()),
                    pii_fields: vec![PiiField::ThreadTitle, PiiField::ThreadUsername],
                },
                message: NormalizedMessage {
                    id: "msg-1".into(),
                    thread_id: "thread-1".into(),
                    source: MessageSource::Telegram,
                    content: MessageContent::Text {
                        text: "Schedule espresso tasting".into(),
                    },
                    sender: Some(SenderMetadata {
                        id: "sender-1".into(),
                        is_bot: false,
                        first_name: Some("Alex".into()),
                        last_name: None,
                        username: Some("alex".into()),
                        language_code: Some("en".into()),
                    }),
                    timestamp: Utc::now(),
                    edited_timestamp: None,
                    pii_fields: vec![PiiField::MessageText],
                },
            },
            locale: Some("en-US".into()),
            timezone: Some("Europe/Amsterdam".into()),
            tags: vec![],
        }
    }

    #[test]
    fn payload_maps_pii_categories() {
        let payload = PolicyCheckPayload::from_plan_request(&sample_plan_request());

        let pii = payload.pii.expect("pii context");
        assert!(pii.categories.contains(&PiiCategory::BasicContact));
        assert!(pii.categories.contains(&PiiCategory::Other));
        assert_eq!(payload.user_id.as_deref(), Some("subject-17"));
        let pam_profile = payload.pam_profile.expect("pam profile");
        assert_eq!(pam_profile.profile_id, "pam-default");
        assert_eq!(pam_profile.version.as_deref(), Some("v1"));

        assert!(payload.spend.is_none());
        assert!(payload.legal.is_none());
    }

    #[test]
    fn payload_defaults_user_id_when_user_context_missing() {
        let mut request = sample_plan_request();
        request.user = None;

        let payload = PolicyCheckPayload::from_plan_request(&request);
        assert_eq!(payload.user_id.as_deref(), Some("subject-17"));
        assert!(payload.pam_profile.is_none());
    }

    #[tokio::test]
    async fn client_decodes_policy_responses() {
        let (client, handle) = policy_server(json!({
            "decision": "approve",
            "rules": [
                {
                    "rule": "spend_limit",
                    "outcome": "approve",
                    "detail": "Spend within default limit",
                },
                {
                    "rule": "pii_guardrail",
                    "outcome": "approve",
                    "detail": "Only basic contact",
                },
                {
                    "rule": "legal_compliance",
                    "outcome": "approve",
                    "detail": "No legal flags",
                }
            ],
        }))
        .await;

        let decision = client
            .check(&sample_plan_request())
            .await
            .expect("policy decision");

        handle.abort();

        assert_eq!(decision.decision, PolicyDecisionKind::Approve);
        assert_eq!(decision.rules.len(), 3);
    }

    #[tokio::test]
    async fn client_surfaces_escalate_and_deny() {
        let (client, handle) = policy_server(json!({
            "decision": "deny",
            "rules": [
                {
                    "rule": "spend_limit",
                    "outcome": "escalate",
                    "detail": "Missing spend context",
                },
                {
                    "rule": "pii_guardrail",
                    "outcome": "deny",
                    "detail": "Biometric data present",
                }
            ],
        }))
        .await;

        let decision = client
            .check(&sample_plan_request())
            .await
            .expect("policy decision");

        handle.abort();

        assert_eq!(decision.decision, PolicyDecisionKind::Deny);
        assert!(
            decision
                .rules
                .iter()
                .any(|rule| rule.outcome == PolicyDecisionKind::Deny)
        );
    }

    async fn policy_server(response: serde_json::Value) -> (PolicyClient, JoinHandle<()>) {
        let body = response;
        let app = Router::new().route(
            "/policy/check",
            post(move || {
                let response = body.clone();
                async move { Json(response) }
            }),
        );

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind policy listener");
        let addr = listener.local_addr().expect("read addr");
        let url = Url::parse(&format!("http://{}", addr)).expect("parse url");

        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("policy server failed");
        });

        (PolicyClient::new(url), server)
    }
}
