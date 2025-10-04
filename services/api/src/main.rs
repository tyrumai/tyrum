use std::{env, net::SocketAddr};

use crate::waitlist::{NewWaitlistSignup, WaitlistError, WaitlistRepository};

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use telemetry::TelemetryGuard;
use validator::Validate;

mod metrics;
mod telemetry;
mod waitlist;

const DEFAULT_BIND_ADDR: &str = "0.0.0.0:8080";
const DEFAULT_DATABASE_URL: &str = "postgres://tyrum:tyrum_dev_password@localhost:5432/tyrum_dev";
const WAITLIST_ROUTE: &str = "/waitlist";

#[derive(Clone)]
struct AppState {
    waitlist: WaitlistRepository,
}

#[derive(Clone, Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Clone, Serialize)]
struct WelcomeResponse {
    message: &'static str,
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
async fn main() {
    let _telemetry = TelemetryGuard::install("tyrum-api").expect("failed to initialize telemetry");

    let bind_addr: SocketAddr = env::var("API_BIND_ADDR")
        .unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string())
        .parse()
        .expect("invalid API_BIND_ADDR");

    let database_url =
        env::var("DATABASE_URL").unwrap_or_else(|_| DEFAULT_DATABASE_URL.to_string());

    let waitlist = WaitlistRepository::connect(&database_url)
        .await
        .expect("failed to connect to Postgres");
    waitlist
        .migrate()
        .await
        .expect("failed to run waitlist migrations");

    let app = build_router(AppState { waitlist });

    tracing::info!("listening on {}", bind_addr);
    axum::serve(tokio::net::TcpListener::bind(bind_addr).await.unwrap(), app)
        .await
        .expect("server exited unexpectedly");
}

#[cfg(test)]
mod tests {
    use super::{AppState, WAITLIST_ROUTE, build_router, sanitize_opt};
    use crate::waitlist::{NewWaitlistSignup, WaitlistError, WaitlistRepository};
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use sqlx::{Row, postgres::PgPoolOptions};
    use std::time::Duration;
    use testcontainers::{
        ContainerAsync, GenericImage, ImageExt,
        core::{IntoContainerPort, WaitFor},
        runners::AsyncRunner,
    };
    use tokio::time::sleep;
    use tower::ServiceExt;

    const POSTGRES_IMAGE: &str = "pgvector/pgvector";
    const POSTGRES_TAG: &str = "pg16";
    const POSTGRES_USER: &str = "tyrum";
    const POSTGRES_PASSWORD: &str = "tyrum_dev_password";
    const POSTGRES_DB: &str = "tyrum_dev";

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

    struct TestContext {
        #[allow(dead_code)]
        container: ContainerAsync<GenericImage>,
        router: axum::Router,
        repository: WaitlistRepository,
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

            let repository = connect_with_retry(&database_url).await;
            repository.migrate().await.expect("run waitlist migrations");

            let router = build_router(AppState {
                waitlist: repository.clone(),
            });

            Self {
                container,
                router,
                repository,
            }
        }
    }

    #[tokio::test]
    async fn health_endpoint_returns_ok() {
        let pool = PgPoolOptions::new()
            .connect_lazy("postgres://postgres:postgres@localhost:5432/postgres")
            .expect("create lazy pool");
        let state = AppState {
            waitlist: WaitlistRepository::from_pool(pool),
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
    async fn waitlist_signup_persists_email() {
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
                .fetch_one(ctx.repository.pool())
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
        let ctx = TestContext::new().await;
        let first = NewWaitlistSignup::new("duplicate@example.com".into());
        ctx.repository
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

    #[test]
    fn sanitize_opt_trims_and_drops_empty() {
        assert_eq!(sanitize_opt(Some("  foo  ".into())), Some("foo".into()));
        assert_eq!(sanitize_opt(Some("   ".into())), None);
        assert_eq!(sanitize_opt(None), None);
    }
}
