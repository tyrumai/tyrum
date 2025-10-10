use std::{collections::HashMap, env, net::SocketAddr};

use anyhow::{Context, Result, anyhow};

use tyrum_api::{
    account_linking::AccountLinkingRepository,
    audit::{AuditTimelineError, AuditTimelineRepository},
    ingress::{IngressRepository, IngressRepositoryError},
    metrics,
    profiles::{
        DEFAULT_PAM_PROFILE_ID, DEFAULT_PVP_PROFILE_ID, PamProfileUpdateRequest,
        ProfilesRepository, PvpProfileUpdateRequest,
    },
    telegram,
    telemetry::TelemetryGuard,
    waitlist::{NewWaitlistSignup, WaitlistError, WaitlistRepository},
    watchers::{
        RegisterWatcherError, WATCHERS_ROUTE, WatcherRegistrationRequest,
        WatcherRegistrationResponse, WatcherRepository, process_registration,
    },
};

use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tyrum_shared::telegram::{TelegramNormalizationError, normalize_update};
use uuid::Uuid;
use validator::Validate;

const DEFAULT_BIND_ADDR: &str = "0.0.0.0:8080";
const DEFAULT_DATABASE_URL: &str = "postgres://tyrum:tyrum_dev_password@localhost:5432/tyrum_dev";
const WAITLIST_ROUTE: &str = "/waitlist";
const ACCOUNT_LINKING_ROUTE: &str = "/account-linking/preferences";
const ACCOUNT_LINKING_TOGGLE_ROUTE: &str = "/account-linking/preferences/:integration_slug";
const AUDIT_PLAN_TIMELINE_ROUTE: &str = "/audit/plan/:plan_id";
const TELEGRAM_WEBHOOK_ROUTE: &str = "/telegram/webhook";
const PROFILES_ROUTE: &str = "/profiles";
const PROFILE_PAM_ROUTE: &str = "/profiles/pam";
const PROFILE_PVP_ROUTE: &str = "/profiles/pvp";
const PORTAL_ACCOUNT_ID: &str = "11111111-2222-3333-4444-555555555555";

#[derive(Clone, Copy)]
struct IntegrationDefinition {
    slug: &'static str,
    name: &'static str,
    description: &'static str,
}

const PLACEHOLDER_INTEGRATIONS: &[IntegrationDefinition] = &[
    IntegrationDefinition {
        slug: "calendar-suite",
        name: "Calendar Suite",
        description: "Sync meetings and hold buffers across Google and Outlook calendars.",
    },
    IntegrationDefinition {
        slug: "expense-forwarders",
        name: "Expense Forwarders",
        description: "Route receipts and approvals into the planner's spend controls.",
    },
    IntegrationDefinition {
        slug: "travel-briefings",
        name: "Travel Briefings",
        description: "Share itineraries and alert windows for concierge follow-ups.",
    },
];

#[derive(Clone)]
struct AppState {
    waitlist: WaitlistRepository,
    account_linking: AccountLinkingRepository,
    ingress: IngressRepository,
    audit: AuditTimelineRepository,
    watchers: WatcherRepository,
    telegram: telegram::TelegramWebhookVerifier,
    profiles: ProfilesRepository,
    portal_subject_id: Uuid,
}

#[derive(Clone, Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Clone, Serialize)]
struct WelcomeResponse {
    message: &'static str,
}

#[derive(Debug, Serialize)]
struct IntegrationPreferenceResponse {
    slug: String,
    name: &'static str,
    description: &'static str,
    enabled: bool,
}

#[derive(Debug, Serialize)]
struct AccountLinkingListResponse {
    account_id: &'static str,
    integrations: Vec<IntegrationPreferenceResponse>,
}

#[derive(Debug, Deserialize)]
struct UpdatePreferenceRequest {
    enabled: bool,
}

#[derive(Debug, Serialize)]
struct UpdatePreferenceResponse {
    status: &'static str,
    integration: IntegrationPreferenceResponse,
}

fn normalize_integration_slug(raw: &str) -> String {
    raw.trim().to_ascii_lowercase()
}

fn integration_definition(slug: &str) -> Option<&'static IntegrationDefinition> {
    PLACEHOLDER_INTEGRATIONS
        .iter()
        .find(|definition| definition.slug == slug)
}

fn assemble_integration_responses(
    toggles: &HashMap<String, bool>,
) -> Vec<IntegrationPreferenceResponse> {
    PLACEHOLDER_INTEGRATIONS
        .iter()
        .map(|definition| IntegrationPreferenceResponse {
            slug: definition.slug.to_string(),
            name: definition.name,
            description: definition.description,
            enabled: toggles.get(definition.slug).copied().unwrap_or(false),
        })
        .collect()
}

#[derive(Debug, Deserialize, Validate)]
struct WaitlistSignupRequest {
    #[validate(email)]
    email: String,
    #[serde(default)]
    #[validate(length(max = 255))]
    utm_source: Option<String>,
    #[serde(default)]
    #[validate(length(max = 255))]
    utm_medium: Option<String>,
    #[serde(default)]
    #[validate(length(max = 255))]
    utm_campaign: Option<String>,
    #[serde(default)]
    #[validate(length(max = 255))]
    utm_term: Option<String>,
    #[serde(default)]
    #[validate(length(max = 255))]
    utm_content: Option<String>,
}

#[derive(Debug, Serialize)]
struct WaitlistSignupResponse {
    status: &'static str,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: &'static str,
    message: String,
}

fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(index))
        .route("/healthz", get(health))
        .route(WAITLIST_ROUTE, post(create_waitlist_signup))
        .route(AUDIT_PLAN_TIMELINE_ROUTE, get(get_plan_timeline))
        .route(ACCOUNT_LINKING_ROUTE, get(list_account_link_preferences))
        .route(
            ACCOUNT_LINKING_TOGGLE_ROUTE,
            put(update_account_link_preference),
        )
        .route(PROFILES_ROUTE, get(get_profiles))
        .route(PROFILE_PAM_ROUTE, put(update_pam_profile))
        .route(PROFILE_PVP_ROUTE, put(update_pvp_profile))
        .route(WATCHERS_ROUTE, post(register_watcher))
        .route(TELEGRAM_WEBHOOK_ROUTE, post(telegram_webhook))
        .with_state(state)
}

#[tracing::instrument(name = "api.index", skip_all)]
async fn index() -> Response {
    let response = Json(WelcomeResponse {
        message: "Tyrum API skeleton is running",
    })
    .into_response();

    metrics::record_http_request("GET", "/", response.status().as_u16());

    response
}

#[tracing::instrument(name = "api.health", skip_all)]
async fn health() -> Response {
    let response = Json(HealthResponse { status: "ok" }).into_response();

    metrics::record_http_request("GET", "/healthz", response.status().as_u16());

    response
}

#[tracing::instrument(name = "api.audit.timeline", skip_all, fields(plan_id = %plan_id))]
async fn get_plan_timeline(State(state): State<AppState>, Path(plan_id): Path<Uuid>) -> Response {
    let response = match state.audit.fetch_plan_timeline(plan_id).await {
        Ok(timeline) => Json(timeline).into_response(),
        Err(AuditTimelineError::NotFound(_)) => (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "plan_not_found",
                message: format!("Plan {plan_id} was not found in the audit log."),
            }),
        )
            .into_response(),
        Err(AuditTimelineError::Database(error)) => {
            tracing::error!(%plan_id, reason = %error, "failed to load plan timeline");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "server_error",
                    message: "Unable to load plan timeline".into(),
                }),
            )
                .into_response()
        }
    };

    metrics::record_http_request("GET", AUDIT_PLAN_TIMELINE_ROUTE, response.status().as_u16());

    response
}

#[tracing::instrument(name = "api.profiles.get", skip_all)]
async fn get_profiles(State(state): State<AppState>) -> Response {
    let response = match state.profiles.fetch_profiles(state.portal_subject_id).await {
        Ok(envelope) => Json(envelope).into_response(),
        Err(error) => {
            tracing::error!(reason = %error, "failed to fetch profiles");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "profiles_unavailable",
                    message: "Unable to load stored profiles".into(),
                }),
            )
                .into_response()
        }
    };

    metrics::record_http_request("GET", PROFILES_ROUTE, response.status().as_u16());

    response
}

#[tracing::instrument(name = "api.profiles.update_pam", skip_all)]
async fn update_pam_profile(
    State(state): State<AppState>,
    Json(payload): Json<PamProfileUpdateRequest>,
) -> Response {
    if !payload.profile.is_object() {
        let response = (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "invalid_profile",
                message: "profile must be a JSON object".into(),
            }),
        )
            .into_response();
        metrics::record_http_request("PUT", PROFILE_PAM_ROUTE, response.status().as_u16());
        return response;
    }
    if let Some(confidence) = payload.confidence.as_ref()
        && !confidence.is_object()
    {
        let response = (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "invalid_confidence",
                message: "confidence must be a JSON object".into(),
            }),
        )
            .into_response();
        metrics::record_http_request("PUT", PROFILE_PAM_ROUTE, response.status().as_u16());
        return response;
    }

    let response = match state
        .profiles
        .upsert_pam_profile(
            state.portal_subject_id,
            DEFAULT_PAM_PROFILE_ID,
            payload.profile,
            payload.confidence,
        )
        .await
    {
        Ok(profile) => Json(profile).into_response(),
        Err(error) => {
            tracing::error!(reason = %error, "failed to persist pam profile");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "profiles_unavailable",
                    message: "Unable to persist PAM profile".into(),
                }),
            )
                .into_response()
        }
    };

    metrics::record_http_request("PUT", PROFILE_PAM_ROUTE, response.status().as_u16());

    response
}

#[tracing::instrument(name = "api.profiles.update_pvp", skip_all)]
async fn update_pvp_profile(
    State(state): State<AppState>,
    Json(payload): Json<PvpProfileUpdateRequest>,
) -> Response {
    if !payload.profile.is_object() {
        let response = (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "invalid_profile",
                message: "profile must be a JSON object".into(),
            }),
        )
            .into_response();
        metrics::record_http_request("PUT", PROFILE_PVP_ROUTE, response.status().as_u16());
        return response;
    }

    let response = match state
        .profiles
        .upsert_pvp_profile(
            state.portal_subject_id,
            DEFAULT_PVP_PROFILE_ID,
            payload.profile,
        )
        .await
    {
        Ok(profile) => Json(profile).into_response(),
        Err(error) => {
            tracing::error!(reason = %error, "failed to persist pvp profile");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "profiles_unavailable",
                    message: "Unable to persist PVP profile".into(),
                }),
            )
                .into_response()
        }
    };

    metrics::record_http_request("PUT", PROFILE_PVP_ROUTE, response.status().as_u16());

    response
}

#[tracing::instrument(name = "api.account_linking.list", skip_all)]
async fn list_account_link_preferences(State(state): State<AppState>) -> Response {
    let response = match state
        .account_linking
        .list_for_account(PORTAL_ACCOUNT_ID)
        .await
    {
        Ok(records) => {
            let mut toggles = HashMap::new();
            for preference in records {
                toggles.insert(preference.integration_slug, preference.enabled);
            }

            Json(AccountLinkingListResponse {
                account_id: PORTAL_ACCOUNT_ID,
                integrations: assemble_integration_responses(&toggles),
            })
            .into_response()
        }
        Err(error) => {
            tracing::error!("failed to load account linking preferences: {error}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "server_error",
                    message: "Unable to load linking preferences".into(),
                }),
            )
                .into_response()
        }
    };

    metrics::record_http_request("GET", ACCOUNT_LINKING_ROUTE, response.status().as_u16());

    response
}

#[tracing::instrument(
    name = "api.account_linking.update",
    skip_all,
    fields(integration_slug = %integration_slug)
)]
async fn update_account_link_preference(
    State(state): State<AppState>,
    Path(integration_slug): Path<String>,
    Json(payload): Json<UpdatePreferenceRequest>,
) -> Response {
    let normalized_slug = normalize_integration_slug(&integration_slug);

    if normalized_slug.is_empty() {
        tracing::warn!("received empty integration slug");
        let response = (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "invalid_slug",
                message: "Integration slug must be provided.".into(),
            }),
        )
            .into_response();
        metrics::record_http_request(
            "PUT",
            ACCOUNT_LINKING_TOGGLE_ROUTE,
            response.status().as_u16(),
        );
        return response;
    }

    let Some(definition) = integration_definition(&normalized_slug) else {
        tracing::warn!(slug = %normalized_slug, "unknown integration slug supplied");
        let response = (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "unknown_integration",
                message: format!("Integration {normalized_slug} is not supported."),
            }),
        )
            .into_response();
        metrics::record_http_request(
            "PUT",
            ACCOUNT_LINKING_TOGGLE_ROUTE,
            response.status().as_u16(),
        );
        return response;
    };

    let response = match state
        .account_linking
        .upsert_preference(PORTAL_ACCOUNT_ID, &normalized_slug, payload.enabled)
        .await
    {
        Ok(preference) => {
            tracing::info!(
                slug = %preference.integration_slug,
                enabled = preference.enabled,
                "stored linking preference"
            );

            Json(UpdatePreferenceResponse {
                status: "updated",
                integration: IntegrationPreferenceResponse {
                    slug: definition.slug.to_string(),
                    name: definition.name,
                    description: definition.description,
                    enabled: preference.enabled,
                },
            })
            .into_response()
        }
        Err(error) => {
            tracing::error!("failed to persist account linking preference: {error}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "server_error",
                    message: "Unable to persist linking preference".into(),
                }),
            )
                .into_response()
        }
    };

    metrics::record_http_request(
        "PUT",
        ACCOUNT_LINKING_TOGGLE_ROUTE,
        response.status().as_u16(),
    );

    response
}

#[tracing::instrument(name = "api.watchers.register", skip_all)]
async fn register_watcher(
    State(state): State<AppState>,
    Json(payload): Json<WatcherRegistrationRequest>,
) -> Response {
    let mut sanitized = payload.clone();
    sanitized.sanitize();

    let response = match process_registration(&state.watchers, payload).await {
        Ok(watcher) => {
            tracing::info!(
                event_source = %watcher.event_source,
                plan_reference = %watcher.plan_reference,
                "registered watcher definition; auth enforcement pending"
            );
            (
                StatusCode::CREATED,
                Json(WatcherRegistrationResponse {
                    status: "created",
                    watcher,
                }),
            )
                .into_response()
        }
        Err(RegisterWatcherError::Validation { message, .. }) => {
            tracing::warn!(reason = %message, "invalid watcher registration payload");
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "invalid_payload",
                    message,
                }),
            )
                .into_response()
        }
        Err(RegisterWatcherError::Duplicate) => {
            tracing::warn!(
                event_source = %sanitized.event_source,
                plan_reference = %sanitized.plan_reference,
                "duplicate watcher registration attempted"
            );
            (
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    error: "duplicate",
                    message: "Watcher already registered with the same event source, predicate, and plan reference".into(),
                }),
            )
                .into_response()
        }
        Err(RegisterWatcherError::Database(error)) => {
            tracing::error!(reason = %error, "failed to persist watcher registration");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "server_error",
                    message: "Unable to persist watcher registration".into(),
                }),
            )
                .into_response()
        }
    };

    metrics::record_http_request("POST", WATCHERS_ROUTE, response.status().as_u16());

    response
}

#[tracing::instrument(name = "api.telegram.webhook", skip_all)]
async fn telegram_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let response = match state.telegram.verify(&headers, &body) {
        Err(error) => {
            tracing::warn!(reason = %error, "telegram webhook signature validation failed");
            (
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    error: "invalid_signature",
                    message: "Telegram webhook signature validation failed".into(),
                }),
            )
                .into_response()
        }
        Ok(()) => match normalize_update(body.as_ref()) {
            Ok(normalized) => {
                let source = normalized.message.source;
                if let Err(error) = state
                    .ingress
                    .upsert_thread(source, &normalized.thread)
                    .await
                {
                    tracing::error!(reason = %error, "failed to persist ingress thread");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            error: "server_error",
                            message: "Unable to persist thread for Telegram payload".into(),
                        }),
                    )
                        .into_response()
                } else {
                    match state.ingress.insert_message(&normalized.message).await {
                        Ok(()) => StatusCode::OK.into_response(),
                        Err(IngressRepositoryError::MessageAlreadyExists) => {
                            tracing::info!(
                                "telegram message already persisted; treating as idempotent"
                            );
                            StatusCode::OK.into_response()
                        }
                        Err(error) => {
                            tracing::error!(reason = %error, "failed to persist ingress message");
                            (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(ErrorResponse {
                                    error: "server_error",
                                    message: "Unable to persist Telegram message".into(),
                                }),
                            )
                                .into_response()
                        }
                    }
                }
            }
            Err(error) => {
                tracing::warn!(reason = %error, "failed to normalize telegram update");
                let message = match error {
                    TelegramNormalizationError::InvalidPayload(_) => {
                        "Telegram payload could not be parsed"
                    }
                    TelegramNormalizationError::MissingMessage => {
                        "Telegram payload did not include a message"
                    }
                    _ => "Telegram payload could not be normalized",
                };
                (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: "invalid_payload",
                        message: message.into(),
                    }),
                )
                    .into_response()
            }
        },
    };

    metrics::record_http_request("POST", TELEGRAM_WEBHOOK_ROUTE, response.status().as_u16());

    response
}

#[tracing::instrument(name = "api.waitlist.create", skip_all)]
async fn create_waitlist_signup(
    State(state): State<AppState>,
    Json(mut payload): Json<WaitlistSignupRequest>,
) -> Response {
    payload.email = payload.email.trim().to_string();
    payload.utm_source = sanitize_opt(payload.utm_source);
    payload.utm_medium = sanitize_opt(payload.utm_medium);
    payload.utm_campaign = sanitize_opt(payload.utm_campaign);
    payload.utm_term = sanitize_opt(payload.utm_term);
    payload.utm_content = sanitize_opt(payload.utm_content);

    let response = match payload.validate() {
        Ok(_) => {
            let signup = NewWaitlistSignup::new(payload.email).with_campaign_params(
                payload.utm_source,
                payload.utm_medium,
                payload.utm_campaign,
                payload.utm_term,
                payload.utm_content,
            );

            match state.waitlist.insert(signup).await {
                Ok(record) => {
                    tracing::info!("captured waitlist signup");
                    (
                        StatusCode::CREATED,
                        Json(WaitlistSignupResponse {
                            status: "created",
                            created_at: record.created_at,
                        }),
                    )
                        .into_response()
                }
                Err(WaitlistError::AlreadyRegistered) => {
                    tracing::warn!("waitlist email already registered");
                    (
                        StatusCode::CONFLICT,
                        Json(ErrorResponse {
                            error: "duplicate",
                            message: "Email already registered for the waitlist".into(),
                        }),
                    )
                        .into_response()
                }
                Err(error) => {
                    tracing::error!("failed to persist waitlist signup: {error}");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            error: "server_error",
                            message: "Unable to persist waitlist signup".into(),
                        }),
                    )
                        .into_response()
                }
            }
        }
        Err(validation_error) => {
            tracing::warn!("invalid waitlist payload: {validation_error}");
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "invalid_payload",
                    message: validation_error.to_string(),
                }),
            )
                .into_response()
        }
    };

    metrics::record_http_request("POST", WAITLIST_ROUTE, response.status().as_u16());

    response
}

fn sanitize_opt(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

#[tokio::main]
async fn main() -> Result<()> {
    let _telemetry = TelemetryGuard::install("tyrum-api")
        .map_err(|err| anyhow!("failed to initialize telemetry: {err}"))?;

    let bind_addr: SocketAddr = env::var("API_BIND_ADDR")
        .unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string())
        .parse()
        .context("invalid API_BIND_ADDR")?;

    let database_url =
        env::var("DATABASE_URL").unwrap_or_else(|_| DEFAULT_DATABASE_URL.to_string());

    let waitlist = WaitlistRepository::connect(&database_url)
        .await
        .context("failed to connect to Postgres")?;
    waitlist
        .migrate()
        .await
        .context("failed to run waitlist migrations")?;

    if matches!(
        env::var("RUN_MIGRATIONS_ONLY"),
        Ok(value) if matches!(value.as_str(), "1" | "true" | "TRUE" | "True")
    ) {
        tracing::info!("database migrations completed; exiting early per RUN_MIGRATIONS_ONLY");
        return Ok(());
    }

    let account_linking = AccountLinkingRepository::new(waitlist.pool().clone());
    let ingress = IngressRepository::new(waitlist.pool().clone());
    let audit = AuditTimelineRepository::new(waitlist.pool().clone());
    let watchers = WatcherRepository::new(waitlist.pool().clone());
    let profiles = ProfilesRepository::new(waitlist.pool().clone());
    let portal_subject_id =
        Uuid::parse_str(PORTAL_ACCOUNT_ID).context("PORTAL_ACCOUNT_ID must be a valid UUID")?;

    let telegram_secret =
        env::var("TELEGRAM_WEBHOOK_SECRET").context("TELEGRAM_WEBHOOK_SECRET must be set")?;
    let telegram = telegram::TelegramWebhookVerifier::new(telegram_secret)
        .context("invalid telegram webhook secret")?;

    let app = build_router(AppState {
        waitlist,
        account_linking,
        ingress,
        audit,
        watchers,
        telegram,
        profiles,
        portal_subject_id,
    });

    tracing::info!("listening on {}", bind_addr);
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .context("failed to bind API socket")?;
    axum::serve(listener, app)
        .await
        .context("server exited unexpectedly")?;

    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]

    use super::{
        ACCOUNT_LINKING_ROUTE, AppState, AuditTimelineRepository, PLACEHOLDER_INTEGRATIONS,
        PORTAL_ACCOUNT_ID, PROFILE_PAM_ROUTE, PROFILE_PVP_ROUTE, PROFILES_ROUTE,
        TELEGRAM_WEBHOOK_ROUTE, WAITLIST_ROUTE, build_router, sanitize_opt,
    };
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use chrono::Utc;
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use sqlx::{PgPool, Row, postgres::PgPoolOptions};
    use std::{path::Path, time::Duration};
    use testcontainers::{
        ContainerAsync, GenericImage, ImageExt,
        core::{IntoContainerPort, WaitFor},
        runners::AsyncRunner,
    };
    use tokio::time::sleep;
    use tower::ServiceExt;
    use tyrum_api::{
        account_linking::AccountLinkingRepository,
        ingress::IngressRepository,
        profiles::ProfilesRepository,
        telegram::TelegramWebhookVerifier,
        waitlist::{NewWaitlistSignup, WaitlistError, WaitlistRepository},
        watchers::WatcherRepository,
    };
    use tyrum_planner::{AppendOutcome, EventLog, NewPlannerEvent};
    use uuid::Uuid;

    const POSTGRES_IMAGE: &str = "pgvector/pgvector";
    const POSTGRES_TAG: &str = "pg16";
    const POSTGRES_USER: &str = "tyrum";
    const POSTGRES_PASSWORD: &str = "tyrum_dev_password";
    const POSTGRES_DB: &str = "tyrum_dev";

    async fn ensure_planner_event_log_schema(pool: &PgPool) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS planner_events (
                id BIGSERIAL PRIMARY KEY,
                replay_id UUID NOT NULL,
                plan_id UUID NOT NULL,
                step_index INTEGER NOT NULL CHECK (step_index >= 0),
                occurred_at TIMESTAMPTZ NOT NULL,
                action JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            "#,
        )
        .execute(pool)
        .await?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS planner_events_replay_id_idx
            ON planner_events (replay_id)
            "#,
        )
        .execute(pool)
        .await?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS planner_events_plan_step_idx
            ON planner_events (plan_id, step_index)
            "#,
        )
        .execute(pool)
        .await?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS planner_events_plan_created_idx
            ON planner_events (plan_id, created_at)
            "#,
        )
        .execute(pool)
        .await?;

        Ok(())
    }

    fn docker_available() -> bool {
        std::env::var("DOCKER_HOST").is_ok()
            || std::env::var("TESTCONTAINERS_HOST_OVERRIDE").is_ok()
            || Path::new("/var/run/docker.sock").exists()
    }

    async fn connect_with_retry(database_url: &str) -> WaitlistRepository {
        let mut attempts = 0;
        loop {
            match WaitlistRepository::connect(database_url).await {
                Ok(repository) => break repository,
                Err(WaitlistError::Database(error))
                    if attempts < 10 && matches!(error, sqlx::Error::Io(_)) =>
                {
                    attempts += 1;
                    sleep(Duration::from_millis(150)).await;
                }
                Err(err) => panic!("connect waitlist repository: {err}"),
            }
        }
    }

    const TELEGRAM_SECRET: &str = "test-telegram-secret";

    struct TestContext {
        #[allow(dead_code)]
        container: ContainerAsync<GenericImage>,
        router: axum::Router,
        waitlist: WaitlistRepository,
        account_linking: AccountLinkingRepository,
        ingress: IngressRepository,
        profiles: ProfilesRepository,
        telegram: TelegramWebhookVerifier,
    }

    impl TestContext {
        async fn new() -> Self {
            let image = GenericImage::new(POSTGRES_IMAGE, POSTGRES_TAG)
                .with_exposed_port(5432.tcp())
                .with_wait_for(WaitFor::message_on_stdout(
                    "database system is ready to accept connections",
                ));

            let request = image
                .with_env_var("POSTGRES_USER", POSTGRES_USER)
                .with_env_var("POSTGRES_PASSWORD", POSTGRES_PASSWORD)
                .with_env_var("POSTGRES_DB", POSTGRES_DB);

            let container = request.start().await.expect("start postgres container");
            let host_port = container
                .get_host_port_ipv4(5432.tcp())
                .await
                .expect("map postgres port");

            let database_url = format!(
                "postgres://{}:{}@127.0.0.1:{}/{}",
                POSTGRES_USER, POSTGRES_PASSWORD, host_port, POSTGRES_DB
            );

            let waitlist = connect_with_retry(&database_url).await;
            waitlist.migrate().await.expect("run waitlist migrations");

            let account_linking = AccountLinkingRepository::new(waitlist.pool().clone());
            let ingress = IngressRepository::new(waitlist.pool().clone());
            let watchers = WatcherRepository::new(waitlist.pool().clone());
            let profiles = ProfilesRepository::new(waitlist.pool().clone());
            let portal_subject_id =
                Uuid::parse_str(PORTAL_ACCOUNT_ID).expect("valid portal subject uuid");
            ensure_planner_event_log_schema(waitlist.pool())
                .await
                .expect("seed planner event log schema");
            let telegram =
                TelegramWebhookVerifier::new(TELEGRAM_SECRET).expect("construct telegram verifier");

            let router = build_router(AppState {
                waitlist: waitlist.clone(),
                account_linking: account_linking.clone(),
                ingress: ingress.clone(),
                audit: AuditTimelineRepository::new(waitlist.pool().clone()),
                watchers: watchers.clone(),
                telegram: telegram.clone(),
                profiles: profiles.clone(),
                portal_subject_id,
            });

            Self {
                container,
                router,
                waitlist,
                account_linking,
                ingress,
                profiles,
                telegram,
            }
        }
    }

    #[tokio::test]
    async fn health_endpoint_returns_ok() {
        let pool = PgPoolOptions::new()
            .connect_lazy("postgres://postgres:postgres@localhost:5432/postgres")
            .expect("create lazy pool");
        let waitlist = WaitlistRepository::from_pool(pool.clone());
        let ingress = IngressRepository::new(pool.clone());
        let account_linking = AccountLinkingRepository::new(pool);
        let watchers = WatcherRepository::new(waitlist.pool().clone());
        if let Err(error) = ensure_planner_event_log_schema(waitlist.pool()).await {
            eprintln!("skipping planner event log schema for health test: {error}");
        }
        let audit = AuditTimelineRepository::new(waitlist.pool().clone());
        let profiles = ProfilesRepository::new(waitlist.pool().clone());
        let telegram =
            TelegramWebhookVerifier::new(TELEGRAM_SECRET).expect("construct telegram verifier");
        let portal_subject_id =
            Uuid::parse_str(PORTAL_ACCOUNT_ID).expect("valid portal subject uuid");
        let state = AppState {
            waitlist,
            account_linking,
            ingress,
            audit,
            watchers,
            telegram,
            profiles,
            portal_subject_id,
        };
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let value: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(value, json!({"status": "ok" }));
    }

    #[tokio::test]
    async fn audit_timeline_endpoint_returns_ordered_events_with_redactions() {
        if !docker_available() {
            eprintln!(
                "skipping audit_timeline_endpoint_returns_ordered_events_with_redactions: docker unavailable"
            );
            return;
        }
        let ctx = TestContext::new().await;
        let app = ctx.router.clone();

        let plan_id = Uuid::new_v4();
        let replay_redacted = Uuid::new_v4();
        let replay_clean = Uuid::new_v4();
        let event_log = EventLog::from_pool(ctx.waitlist.pool().clone());
        let occurred_at = Utc::now();

        let redacted_action = json!({
            "kind": "executor_result",
            "result": {
                "detail": "[redacted]",
                "status": "success"
            }
        });

        let clean_action = json!({
            "kind": "plan_summary",
            "result": {
                "status": "success",
                "notes": "Completed"
            }
        });

        let outcome_one = event_log
            .append(NewPlannerEvent::new(
                replay_redacted,
                plan_id,
                0,
                occurred_at,
                redacted_action,
            ))
            .await
            .expect("append first audit event");
        assert!(matches!(outcome_one, AppendOutcome::Inserted(_)));

        let outcome_two = event_log
            .append(NewPlannerEvent::new(
                replay_clean,
                plan_id,
                1,
                occurred_at,
                clean_action,
            ))
            .await
            .expect("append second audit event");
        assert!(matches!(outcome_two, AppendOutcome::Inserted(_)));

        let path = format!("/audit/plan/{plan_id}");
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(&path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();

        let expected_plan_id = plan_id.to_string();
        assert_eq!(
            payload.get("plan_id").and_then(Value::as_str),
            Some(expected_plan_id.as_str())
        );
        assert_eq!(payload.get("event_count").and_then(Value::as_u64), Some(2));
        assert_eq!(
            payload.get("has_redactions").and_then(Value::as_bool),
            Some(true)
        );

        let events = payload
            .get("events")
            .and_then(Value::as_array)
            .expect("timeline events array");
        assert_eq!(events.len(), 2);

        let first = &events[0];
        assert_eq!(first.get("step_index").and_then(Value::as_i64), Some(0));
        let redactions = first
            .get("redactions")
            .and_then(Value::as_array)
            .expect("redactions for first event");
        assert!(
            redactions
                .iter()
                .any(|val| val.as_str() == Some("/action/result/detail"))
        );

        let second = &events[1];
        assert_eq!(second.get("step_index").and_then(Value::as_i64), Some(1));
        assert!(second.get("redactions").is_none());
    }

    #[tokio::test]
    async fn audit_timeline_endpoint_returns_404_for_missing_plan() {
        if !docker_available() {
            eprintln!(
                "skipping audit_timeline_endpoint_returns_404_for_missing_plan: docker unavailable"
            );
            return;
        }
        let ctx = TestContext::new().await;
        let app = ctx.router.clone();

        let plan_id = Uuid::new_v4();
        let path = format!("/audit/plan/{plan_id}");

        let response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(&path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            payload.get("error").and_then(Value::as_str),
            Some("plan_not_found")
        );
    }

    #[tokio::test]
    async fn waitlist_signup_persists_email() {
        if !docker_available() {
            eprintln!("skipping waitlist_signup_persists_email: docker unavailable");
            return;
        }
        let ctx = TestContext::new().await;
        let app = ctx.router.clone();
        let payload = json!({
            "email": "founder@example.com",
            "utm_source": "homepage",
            "utm_medium": "hero",
            "utm_campaign": "launch"
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(WAITLIST_ROUTE)
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 201);
        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let value: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(value["status"], "created");

        let row =
            sqlx::query("SELECT email, utm_source, utm_medium, utm_campaign FROM waitlist_signups")
                .fetch_one(ctx.waitlist.pool())
                .await
                .expect("fetch waitlist signup");
        assert_eq!(
            row.try_get::<String, _>("email").unwrap(),
            "founder@example.com"
        );
        assert_eq!(
            row.try_get::<Option<String>, _>("utm_source").unwrap(),
            Some("homepage".into())
        );
        assert_eq!(
            row.try_get::<Option<String>, _>("utm_medium").unwrap(),
            Some("hero".into())
        );
        assert_eq!(
            row.try_get::<Option<String>, _>("utm_campaign").unwrap(),
            Some("launch".into())
        );
    }

    #[tokio::test]
    async fn waitlist_signup_rejects_duplicates() {
        if !docker_available() {
            eprintln!("skipping waitlist_signup_rejects_duplicates: docker unavailable");
            return;
        }
        let ctx = TestContext::new().await;
        let first = NewWaitlistSignup::new("duplicate@example.com".into());
        ctx.waitlist
            .insert(first)
            .await
            .expect("seed waitlist record");

        let app = ctx.router.clone();
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(WAITLIST_ROUTE)
                    .header("content-type", "application/json")
                    .body(Body::from("{\"email\": \"duplicate@example.com\"}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 409);
        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let value: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(value["error"], "duplicate");
    }

    #[tokio::test]
    async fn account_linking_list_returns_defaults() {
        if !docker_available() {
            eprintln!("skipping account_linking_list_returns_defaults: docker unavailable");
            return;
        }
        let ctx = TestContext::new().await;
        let app = ctx.router.clone();

        let response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(ACCOUNT_LINKING_ROUTE)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 200);

        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let value: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(value["account_id"], PORTAL_ACCOUNT_ID);
        let integrations = value["integrations"]
            .as_array()
            .expect("integrations array");
        assert_eq!(integrations.len(), PLACEHOLDER_INTEGRATIONS.len());
        assert!(
            integrations
                .iter()
                .all(|entry| entry["enabled"] == Value::Bool(false))
        );
    }

    #[tokio::test]
    async fn account_linking_update_persists_toggle() {
        if !docker_available() {
            eprintln!("skipping account_linking_update_persists_toggle: docker unavailable");
            return;
        }
        let ctx = TestContext::new().await;
        let slug = PLACEHOLDER_INTEGRATIONS[0].slug;
        let app = ctx.router.clone();
        let payload = json!({ "enabled": true });

        let response = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("{}/{}", ACCOUNT_LINKING_ROUTE, slug))
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let value: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(value["status"], "updated");
        assert_eq!(value["integration"]["slug"], slug);
        assert_eq!(value["integration"]["enabled"], Value::Bool(true));

        let stored = ctx
            .account_linking
            .list_for_account(PORTAL_ACCOUNT_ID)
            .await
            .expect("fetch stored preferences");
        assert!(
            stored
                .iter()
                .any(|entry| entry.integration_slug == slug && entry.enabled)
        );

        let verify = ctx.router.clone();
        let refreshed = verify
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(ACCOUNT_LINKING_ROUTE)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(refreshed.status(), 200);
        let refreshed_body = refreshed.into_body().collect().await.unwrap().to_bytes();
        let refreshed_value: Value = serde_json::from_slice(&refreshed_body).unwrap();
        let updated_entry = refreshed_value["integrations"]
            .as_array()
            .expect("integrations array")
            .iter()
            .find(|entry| entry["slug"] == slug)
            .cloned()
            .expect("integration row present");
        assert_eq!(updated_entry["enabled"], Value::Bool(true));
    }

    #[tokio::test]
    async fn telegram_webhook_accepts_valid_signature() {
        if !docker_available() {
            eprintln!("skipping telegram_webhook_accepts_valid_signature: docker unavailable");
            return;
        }
        let ctx = TestContext::new().await;
        let app = ctx.router.clone();
        let payload = r#"{"update_id":123,"message":{"message_id":7,"date":1710000000,"chat":{"id":42,"type":"private"},"text":"ping"}}"#;
        let signature = ctx.telegram.expected_signature_header(payload.as_bytes());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(TELEGRAM_WEBHOOK_ROUTE)
                    .header("content-type", "application/json")
                    .header("X-Telegram-Bot-Api-Secret-Token", TELEGRAM_SECRET)
                    .header("X-Telegram-Bot-Api-Signature", signature)
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn telegram_webhook_rejects_invalid_signature() {
        if !docker_available() {
            eprintln!("skipping telegram_webhook_rejects_invalid_signature: docker unavailable");
            return;
        }
        let ctx = TestContext::new().await;
        let app = ctx.router.clone();
        let payload = r#"{"update_id":123}"#;

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(TELEGRAM_WEBHOOK_ROUTE)
                    .header("content-type", "application/json")
                    .header("X-Telegram-Bot-Api-Secret-Token", TELEGRAM_SECRET)
                    .header("X-Telegram-Bot-Api-Signature", "sha256=deadbeef")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires docker"]
    async fn telegram_webhook_e2e() {
        if !docker_available() {
            eprintln!("skipping telegram_webhook_e2e: docker unavailable");
            return;
        }
        let ctx = TestContext::new().await;
        let app = ctx.router.clone();
        let payload = include_str!("../../../shared/tests/fixtures/telegram/text_message.json");
        let signature = ctx.telegram.expected_signature_header(payload.as_bytes());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(TELEGRAM_WEBHOOK_ROUTE)
                    .header("content-type", "application/json")
                    .header("X-Telegram-Bot-Api-Secret-Token", TELEGRAM_SECRET)
                    .header("X-Telegram-Bot-Api-Signature", signature)
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let thread_row = sqlx::query(
            r#"
            SELECT kind, title, username, pii_fields
            FROM ingress_threads
            WHERE source = $1 AND thread_id = $2
            "#,
        )
        .bind("telegram")
        .bind("987654321")
        .fetch_one(ctx.ingress.pool())
        .await
        .expect("fetch persisted thread");

        assert_eq!(thread_row.try_get::<String, _>("kind").unwrap(), "private");
        assert!(
            thread_row
                .try_get::<Option<String>, _>("title")
                .unwrap()
                .is_none()
        );
        assert!(
            thread_row
                .try_get::<Option<String>, _>("username")
                .unwrap()
                .is_none()
        );
        let thread_pii: Vec<String> = thread_row.try_get("pii_fields").unwrap();
        assert!(thread_pii.is_empty());

        let message_row = sqlx::query(
            r#"
            SELECT message_id, content, sender, pii_fields
            FROM ingress_messages
            WHERE source = $1 AND thread_id = $2 AND message_id = $3
            "#,
        )
        .bind("telegram")
        .bind("987654321")
        .bind("111")
        .fetch_one(ctx.ingress.pool())
        .await
        .expect("fetch persisted message");

        assert_eq!(
            message_row.try_get::<String, _>("message_id").unwrap(),
            "111"
        );
        let content: Value = message_row.try_get("content").unwrap();
        assert_eq!(content["kind"], "text");
        assert_eq!(content["text"], "Hello planner");

        let sender: Value = message_row
            .try_get::<Option<Value>, _>("sender")
            .unwrap()
            .expect("sender metadata stored");
        assert_eq!(sender["id"], "555555");
        assert_eq!(sender["username"], "rons");

        let message_pii: Vec<String> = message_row.try_get("pii_fields").unwrap();
        assert_eq!(
            message_pii,
            vec![
                "message_text",
                "sender_first_name",
                "sender_last_name",
                "sender_username",
                "sender_language_code"
            ]
        );
    }

    #[tokio::test]
    async fn profiles_get_returns_empty_payload() {
        if !docker_available() {
            return;
        }

        let ctx = TestContext::new().await;
        let app = ctx.router.clone();

        let response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(PROFILES_ROUTE)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert!(payload.get("pam").is_none() || payload.get("pam").unwrap().is_null());
        assert!(payload.get("pvp").is_none() || payload.get("pvp").unwrap().is_null());
    }

    #[tokio::test]
    async fn profiles_update_endpoints_store_profiles() {
        if !docker_available() {
            return;
        }

        let ctx = TestContext::new().await;
        let app = ctx.router.clone();
        let subject_id = Uuid::parse_str(PORTAL_ACCOUNT_ID).unwrap();

        let pam_payload = json!({
            "profile": {
                "escalation_mode": "ask_first",
                "auto_approve": {"limit_minor_units": 1_500, "currency": "EUR"}
            },
            "confidence": {
                "escalation_mode": 0.9
            }
        });

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(PROFILE_PAM_ROUTE)
                    .header("content-type", "application/json")
                    .body(Body::from(pam_payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let pam_body: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(pam_body["profile"]["escalation_mode"], json!("ask_first"));
        assert!(pam_body["version"].as_str().is_some());

        let pvp_payload = json!({
            "profile": {
                "tone": "calm",
                "verbosity": "balanced",
                "voice": {
                    "voice_id": "voice_test",
                    "pace": 0.4
                }
            }
        });

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(PROFILE_PVP_ROUTE)
                    .header("content-type", "application/json")
                    .body(Body::from(pvp_payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let stored = ctx
            .profiles
            .fetch_profiles(subject_id)
            .await
            .expect("fetch persisted profiles");
        assert!(stored.pam.is_some());
        assert!(stored.pvp.is_some());

        let response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(PROFILES_ROUTE)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            payload["pam"]["profile"]["escalation_mode"],
            json!("ask_first")
        );
        assert_eq!(
            payload["pvp"]["profile"]["voice"]["voice_id"],
            json!("voice_test")
        );
    }

    #[test]
    fn sanitize_opt_trims_and_drops_empty() {
        assert_eq!(sanitize_opt(Some("  foo  ".into())), Some("foo".into()));
        assert_eq!(sanitize_opt(Some("   ".into())), None);
        assert_eq!(sanitize_opt(None), None);
    }
}
