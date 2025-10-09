#![allow(clippy::expect_used, clippy::unwrap_used)]

use chrono::Utc;
use serde_json::json;
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::path::Path;
use testcontainers::{
    ContainerAsync, GenericImage, ImageExt,
    core::{IntoContainerPort, WaitFor},
    runners::AsyncRunner,
};
use tokio::time::sleep;
use tyrum_api::audit::{AuditTimelineError, AuditTimelineRepository};
use tyrum_planner::{AppendOutcome, EventLog, NewPlannerEvent};
use uuid::Uuid;

const POSTGRES_IMAGE: &str = "pgvector/pgvector";
const POSTGRES_TAG: &str = "pg16";
const POSTGRES_USER: &str = "tyrum";
const POSTGRES_PASSWORD: &str = "tyrum_dev_password";
const POSTGRES_DB: &str = "tyrum_dev";

static API_MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

fn docker_available() -> bool {
    std::env::var("DOCKER_HOST").is_ok()
        || std::env::var("TESTCONTAINERS_HOST_OVERRIDE").is_ok()
        || Path::new("/var/run/docker.sock").exists()
}

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

struct TestContext {
    #[allow(dead_code)]
    container: ContainerAsync<GenericImage>,
    pool: PgPool,
    repository: AuditTimelineRepository,
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
        API_MIGRATOR.run(&pool).await.expect("run api migrations");
        ensure_planner_event_log_schema(&pool)
            .await
            .expect("seed planner event log schema");

        let repository = AuditTimelineRepository::new(pool.clone());

        Self {
            container,
            pool,
            repository,
        }
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
                sleep(std::time::Duration::from_millis(150)).await;
            }
            Err(error) => panic!("connect postgres pool: {error}"),
        }
    }
}

#[tokio::test]
async fn fetch_plan_timeline_returns_ordered_events_with_redactions() {
    if !docker_available() {
        eprintln!(
            "skipping fetch_plan_timeline_returns_ordered_events_with_redactions: docker unavailable"
        );
        return;
    }
    let ctx = TestContext::new().await;
    let plan_id = Uuid::new_v4();
    let replay_one = Uuid::new_v4();
    let replay_two = Uuid::new_v4();
    let occurred_at = Utc::now();

    let event_log = EventLog::from_pool(ctx.pool.clone());

    let outcome_one = event_log
        .append(NewPlannerEvent::new(
            replay_one,
            plan_id,
            0,
            occurred_at,
            json!({
                "kind": "executor_result",
                "result": {
                    "status": "success",
                    "detail": "[redacted]"
                }
            }),
        ))
        .await
        .expect("append first planner event");
    assert!(matches!(outcome_one, AppendOutcome::Inserted(_)));

    let outcome_two = event_log
        .append(NewPlannerEvent::new(
            replay_two,
            plan_id,
            1,
            occurred_at,
            json!({
                "kind": "plan_summary",
                "result": {
                    "status": "success"
                }
            }),
        ))
        .await
        .expect("append second planner event");
    assert!(matches!(outcome_two, AppendOutcome::Inserted(_)));

    let timeline = ctx
        .repository
        .fetch_plan_timeline(plan_id)
        .await
        .expect("load plan timeline");

    assert_eq!(timeline.plan_id, plan_id);
    assert_eq!(timeline.event_count, 2);
    assert!(timeline.has_redactions);
    assert_eq!(timeline.events.len(), 2);
    assert_eq!(timeline.events[0].step_index, 0);
    assert_eq!(timeline.events[1].step_index, 1);
    let redactions = timeline.events[0].redactions.clone();
    assert!(
        redactions
            .iter()
            .any(|entry| entry == "/action/result/detail"),
        "expected redaction pointer in first event"
    );
    assert!(timeline.events[1].redactions.is_empty());
}

#[tokio::test]
async fn fetch_plan_timeline_returns_not_found_for_missing_plan() {
    if !docker_available() {
        eprintln!(
            "skipping fetch_plan_timeline_returns_not_found_for_missing_plan: docker unavailable"
        );
        return;
    }
    let ctx = TestContext::new().await;
    let plan_id = Uuid::new_v4();

    let result = ctx.repository.fetch_plan_timeline(plan_id).await;
    match result {
        Err(AuditTimelineError::NotFound(missing)) => assert_eq!(missing, plan_id),
        other => panic!("expected not found error, got {other:?}"),
    }
}
