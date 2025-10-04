use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{PgPool, Row, migrate::MigrateError, postgres::PgPoolOptions};
use thiserror::Error;
use tracing::instrument;
use uuid::Uuid;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// Settings used to establish pooled connections to the planner event log database.
#[derive(Clone, Debug)]
pub struct EventLogSettings {
    pub database_url: String,
    pub max_connections: u32,
    pub connect_timeout: Duration,
}

impl EventLogSettings {
    pub fn new(database_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
            max_connections: 5,
            connect_timeout: Duration::from_secs(5),
        }
    }

    pub fn with_max_connections(mut self, max_connections: u32) -> Self {
        self.max_connections = max_connections.max(1);
        self
    }

    pub fn with_connect_timeout(mut self, timeout: Duration) -> Self {
        self.connect_timeout = timeout;
        self
    }
}

/// Planner-facing representation of a new action trace entry.
#[derive(Clone, Debug, PartialEq)]
pub struct NewPlannerEvent {
    pub replay_id: Uuid,
    pub plan_id: Uuid,
    pub step_index: i32,
    pub occurred_at: DateTime<Utc>,
    pub action: Value,
}

impl NewPlannerEvent {
    pub fn new(
        replay_id: Uuid,
        plan_id: Uuid,
        step_index: i32,
        occurred_at: DateTime<Utc>,
        action: Value,
    ) -> Self {
        Self {
            replay_id,
            plan_id,
            step_index,
            occurred_at,
            action,
        }
    }

    pub fn from_payload<T: Serialize>(
        replay_id: Uuid,
        plan_id: Uuid,
        step_index: i32,
        occurred_at: DateTime<Utc>,
        payload: &T,
    ) -> Result<Self, EventLogError> {
        let action = serde_json::to_value(payload)?;
        Ok(Self::new(
            replay_id,
            plan_id,
            step_index,
            occurred_at,
            action,
        ))
    }
}

/// Snapshot returned whenever an event is fetched from storage.
#[derive(Clone, Debug, PartialEq)]
pub struct PersistedPlannerEvent {
    pub replay_id: Uuid,
    pub plan_id: Uuid,
    pub step_index: i32,
    pub occurred_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub action: Value,
}

/// Outcome of attempting to append a planner event.
#[derive(Clone, Debug, PartialEq)]
pub enum AppendOutcome {
    Inserted(PersistedPlannerEvent),
    Duplicate,
}

#[derive(Debug, Error)]
pub enum EventLogError {
    #[error("invalid step index {0}; step indices must be zero or greater")]
    InvalidStepIndex(i32),

    #[error("invalid event payload: {0}")]
    Payload(#[from] serde_json::Error),

    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("migration error: {0}")]
    Migration(#[from] MigrateError),
}

/// Append-only facade over the planner event log schema.
#[derive(Clone, Debug)]
pub struct EventLog {
    pool: PgPool,
}

impl EventLog {
    pub async fn connect(settings: EventLogSettings) -> Result<Self, EventLogError> {
        let pool = PgPoolOptions::new()
            .max_connections(settings.max_connections)
            .acquire_timeout(settings.connect_timeout)
            .connect(&settings.database_url)
            .await?;
        Ok(Self { pool })
    }

    pub fn from_pool(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    #[instrument(skip_all)]
    pub async fn migrate(&self) -> Result<(), EventLogError> {
        MIGRATOR.run(&self.pool).await?;
        Ok(())
    }

    #[instrument(skip_all, fields(replay_id = %event.replay_id, plan_id = %event.plan_id, step_index = event.step_index))]
    pub async fn append(&self, event: NewPlannerEvent) -> Result<AppendOutcome, EventLogError> {
        if event.step_index < 0 {
            return Err(EventLogError::InvalidStepIndex(event.step_index));
        }

        let row = sqlx::query(
            r#"
            INSERT INTO planner_events (replay_id, plan_id, step_index, occurred_at, action)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (replay_id) DO NOTHING
            RETURNING replay_id, plan_id, step_index, occurred_at, created_at, action
            "#,
        )
        .bind(event.replay_id)
        .bind(event.plan_id)
        .bind(event.step_index)
        .bind(event.occurred_at)
        .bind(event.action)
        .fetch_optional(&self.pool)
        .await?;

        match row {
            None => Ok(AppendOutcome::Duplicate),
            Some(row) => Ok(AppendOutcome::Inserted(PersistedPlannerEvent {
                replay_id: row.try_get("replay_id")?,
                plan_id: row.try_get("plan_id")?,
                step_index: row.try_get("step_index")?,
                occurred_at: row.try_get("occurred_at")?,
                created_at: row.try_get("created_at")?,
                action: row.try_get("action")?,
            })),
        }
    }

    #[instrument(skip_all, fields(plan_id = %plan_id))]
    pub async fn events_for_plan(
        &self,
        plan_id: Uuid,
    ) -> Result<Vec<PersistedPlannerEvent>, EventLogError> {
        let rows = sqlx::query(
            r#"
            SELECT replay_id, plan_id, step_index, occurred_at, created_at, action
            FROM planner_events
            WHERE plan_id = $1
            ORDER BY step_index ASC
            "#,
        )
        .bind(plan_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| -> Result<PersistedPlannerEvent, sqlx::Error> {
                Ok(PersistedPlannerEvent {
                    replay_id: row.try_get("replay_id")?,
                    plan_id: row.try_get("plan_id")?,
                    step_index: row.try_get("step_index")?,
                    occurred_at: row.try_get("occurred_at")?,
                    created_at: row.try_get("created_at")?,
                    action: row.try_get("action")?,
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(EventLogError::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use testcontainers::{
        ContainerAsync, GenericImage, ImageExt,
        core::{IntoContainerPort, WaitFor},
        runners::AsyncRunner,
    };
    use tokio::time::sleep;

    const POSTGRES_IMAGE: &str = "postgres";
    const POSTGRES_TAG: &str = "16-alpine";
    const POSTGRES_USER: &str = "tyrum";
    const POSTGRES_PASSWORD: &str = "tyrum_dev_password";
    const POSTGRES_DB: &str = "tyrum_dev";

    async fn setup() -> (ContainerAsync<GenericImage>, EventLog) {
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

        let event_log = connect_with_retry(EventLogSettings::new(database_url))
            .await
            .expect("connect event log");
        event_log.migrate().await.expect("run migrations");

        (container, event_log)
    }

    async fn connect_with_retry(settings: EventLogSettings) -> Result<EventLog, EventLogError> {
        let mut attempts = 0;
        let max_attempts = 10;
        loop {
            match EventLog::connect(settings.clone()).await {
                Ok(pool) => break Ok(pool),
                Err(EventLogError::Database(err)) if attempts < max_attempts => {
                    attempts += 1;
                    sleep(Duration::from_millis(200)).await;
                    tracing::warn!(
                        attempts,
                        "waiting for postgres to accept connections: {err}"
                    );
                }
                Err(err) => break Err(err),
            }
        }
    }

    fn new_event(plan_id: Uuid, step_index: i32) -> NewPlannerEvent {
        NewPlannerEvent {
            replay_id: Uuid::new_v4(),
            plan_id,
            step_index,
            occurred_at: Utc::now(),
            action: serde_json::json!({
                "kind": "test",
                "step": step_index,
            }),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn append_inserts_event() {
        let (container, event_log) = setup().await;
        let _container = container;
        let plan_id = Uuid::new_v4();
        let event = new_event(plan_id, 0);
        let outcome = event_log.append(event.clone()).await.unwrap();
        match outcome {
            AppendOutcome::Inserted(inserted) => {
                assert_eq!(inserted.replay_id, event.replay_id);
                assert_eq!(inserted.plan_id, plan_id);
                assert_eq!(inserted.step_index, event.step_index);
                assert_eq!(inserted.action, event.action);
            }
            AppendOutcome::Duplicate => panic!("expected insert"),
        }

        let fetched = event_log.events_for_plan(plan_id).await.unwrap();
        assert_eq!(fetched.len(), 1);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn append_is_idempotent() {
        let (container, event_log) = setup().await;
        let _container = container;
        let plan_id = Uuid::new_v4();
        let event = new_event(plan_id, 1);
        assert!(matches!(
            event_log.append(event.clone()).await.unwrap(),
            AppendOutcome::Inserted(_)
        ));
        assert!(matches!(
            event_log.append(event.clone()).await.unwrap(),
            AppendOutcome::Duplicate
        ));

        let events = event_log.events_for_plan(plan_id).await.unwrap();
        assert_eq!(events.len(), 1);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn events_are_ordered_by_step() {
        let (container, event_log) = setup().await;
        let _container = container;
        let plan_id = Uuid::new_v4();
        for step in 0..3 {
            let event = new_event(plan_id, step);
            assert!(matches!(
                event_log.append(event).await.unwrap(),
                AppendOutcome::Inserted(_)
            ));
        }

        let events = event_log.events_for_plan(plan_id).await.unwrap();
        assert_eq!(events.len(), 3);
        for (expected_step, event) in events.iter().enumerate() {
            assert_eq!(event.step_index, expected_step as i32);
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn reject_negative_steps() {
        let (container, event_log) = setup().await;
        let _container = container;
        let plan_id = Uuid::new_v4();
        let mut event = new_event(plan_id, 0);
        event.step_index = -1;
        let outcome = event_log.append(event).await;
        assert!(matches!(outcome, Err(EventLogError::InvalidStepIndex(-1))));
    }
}
