#![allow(clippy::expect_used, clippy::unwrap_used)]

use axum::{
    Json, Router,
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
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
use tyrum_api::watchers::{
    RegisterWatcherError, WATCHERS_ROUTE, WatcherRegistrationRequest, WatcherRegistrationResponse,
    WatcherRepository, process_registration,
};

const POSTGRES_IMAGE: &str = "pgvector/pgvector";
const POSTGRES_TAG: &str = "pg16";
const POSTGRES_USER: &str = "tyrum";
const POSTGRES_PASSWORD: &str = "tyrum_dev_password";
const POSTGRES_DB: &str = "tyrum_dev";

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

fn docker_available() -> bool {
    std::env::var("DOCKER_HOST").is_ok()
        || std::env::var("TESTCONTAINERS_HOST_OVERRIDE").is_ok()
        || Path::new("/var/run/docker.sock").exists()
}

struct TestContext {
    #[allow(dead_code)]
    container: ContainerAsync<GenericImage>,
    router: Router,
    repository: WatcherRepository,
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

        let pool = connect_with_retry(&database_url).await;
        MIGRATOR.run(&pool).await.expect("run migrations");

        let repository = WatcherRepository::new(pool.clone());
        let router = build_router(repository.clone());

        Self {
            container,
            router,
            repository,
        }
    }
}

fn build_router(repository: WatcherRepository) -> Router {
    Router::new()
        .route(WATCHERS_ROUTE, post(register_watcher_route))
        .with_state(repository)
}

#[tracing::instrument(name = "test.watchers.register", skip(repo, payload))]
async fn register_watcher_route(
    State(repo): State<WatcherRepository>,
    Json(payload): Json<WatcherRegistrationRequest>,
) -> Response {
    let mut sanitized = payload.clone();
    sanitized.sanitize();

    match process_registration(&repo, payload).await {
        Ok(watcher) => (
            StatusCode::CREATED,
            Json(WatcherRegistrationResponse {
                status: "created",
                watcher,
            }),
        )
            .into_response(),
        Err(RegisterWatcherError::Validation { message, .. }) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid_payload", "message": message })),
        )
            .into_response(),
        Err(RegisterWatcherError::Duplicate) => (
            StatusCode::CONFLICT,
            Json(json!({
                "error": "duplicate",
                "event_source": sanitized.event_source,
                "plan_reference": sanitized.plan_reference,
            })),
        )
            .into_response(),
        Err(RegisterWatcherError::Database(error)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "server_error", "message": error.to_string() })),
        )
            .into_response(),
    }
}

async fn connect_with_retry(database_url: &str) -> PgPool {
    let mut attempts = 0;
    loop {
        match PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await
        {
            Ok(pool) => break pool,
            Err(error) if attempts < 10 && matches!(error, sqlx::Error::Io(_)) => {
                attempts += 1;
                sleep(Duration::from_millis(150)).await;
            }
            Err(error) => panic!("connect postgres pool: {error}"),
        }
    }
}

#[tokio::test]
async fn register_watcher_persists_record() {
    if !docker_available() {
        eprintln!("skipping register_watcher_persists_record: docker unavailable");
        return;
    }
    let ctx = TestContext::new().await;
    let app = ctx.router.clone();

    let payload = json!({
        "event_source": "EMAIL",
        "predicate": "subject contains 'VIP'",
        "plan_reference": "plan://follow-up/v1",
        "metadata": { "created_by": "tests" }
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(WATCHERS_ROUTE)
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(value["status"], "created");
    assert_eq!(value["watcher"]["event_source"].as_str().unwrap(), "email");

    let row = sqlx::query(
        "SELECT event_source, predicate, plan_reference, status, metadata FROM watchers",
    )
    .fetch_one(ctx.repository.pool())
    .await
    .expect("fetch watcher row");

    assert_eq!(row.try_get::<String, _>("event_source").unwrap(), "email");
    assert_eq!(
        row.try_get::<String, _>("predicate").unwrap(),
        "subject contains 'VIP'"
    );
    assert_eq!(
        row.try_get::<String, _>("plan_reference").unwrap(),
        "plan://follow-up/v1"
    );
    assert_eq!(row.try_get::<String, _>("status").unwrap(), "active");
    let metadata: Value = row.try_get("metadata").unwrap();
    assert_eq!(metadata["created_by"], "tests");
}

#[tokio::test]
async fn register_watcher_rejects_invalid_source() {
    if !docker_available() {
        eprintln!("skipping register_watcher_rejects_invalid_source: docker unavailable");
        return;
    }
    let ctx = TestContext::new().await;
    let app = ctx.router.clone();

    let payload = json!({
        "event_source": "unknown-surface",
        "predicate": "always()",
        "plan_reference": "plan://noop",
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(WATCHERS_ROUTE)
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(value["error"], "invalid_payload");
    assert!(
        value["message"]
            .as_str()
            .unwrap()
            .contains("event_source must be one of")
    );
}

#[tokio::test]
async fn register_watcher_rejects_duplicates() {
    if !docker_available() {
        eprintln!("skipping register_watcher_rejects_duplicates: docker unavailable");
        return;
    }
    let ctx = TestContext::new().await;
    let app = ctx.router.clone();

    let payload = json!({
        "event_source": "messages",
        "predicate": "thread = 'vip'",
        "plan_reference": "plan://vip-follow-up",
    });

    let first = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(WATCHERS_ROUTE)
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::CREATED);

    let second = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(WATCHERS_ROUTE)
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second.status(), StatusCode::CONFLICT);
    let body_bytes = second.into_body().collect().await.unwrap().to_bytes();
    let value: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(value["error"], "duplicate");
    assert_eq!(value["plan_reference"], "plan://vip-follow-up");
}
