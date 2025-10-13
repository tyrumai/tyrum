use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{Map as JsonMap, Value};
use sqlx::{PgPool, Row, migrate::MigrateError, postgres::PgPoolOptions};
use thiserror::Error;
use tracing::{debug, info, instrument, warn};
use url::Url;
use uuid::Uuid;

use crate::http::sanitize_detail;
use crate::{ActionPrimitive, ActionPrimitiveKind};

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// Settings used to establish pooled connections to the planner event log database.
#[derive(Clone, Debug)]
pub struct EventLogSettings {
    pub database_url: String,
    pub max_connections: u32,
    pub connect_timeout: Duration,
}

impl EventLogSettings {
    #[must_use]
    pub fn new(database_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
            max_connections: 5,
            connect_timeout: Duration::from_secs(5),
        }
    }

    #[must_use]
    pub fn with_max_connections(mut self, max_connections: u32) -> Self {
        self.max_connections = max_connections.max(1);
        self
    }

    #[must_use]
    pub fn with_connect_timeout(mut self, timeout: Duration) -> Self {
        self.connect_timeout = timeout;
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapabilityMemoryResult {
    Inserted { success_count: i32 },
    Updated { success_count: i32 },
    Skipped(CapabilityMemorySkipReason),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapabilityMemorySkipReason {
    NonMutatingPrimitive,
    MissingIdentifier,
}

impl EventLog {
    /// Upsert capability memory details for a completed primitive.
    ///
    /// # Errors
    ///
    /// Returns [`EventLogError::Database`] if the upsert query fails.
    #[instrument(skip_all, fields(subject_id = %subject_id, executor_kind = %executor_kind))]
    pub async fn record_capability_memory(
        &self,
        subject_id: Uuid,
        primitive: &ActionPrimitive,
        executor_kind: &str,
        outcome: &Value,
        occurred_at: DateTime<Utc>,
    ) -> Result<CapabilityMemoryResult, EventLogError> {
        if !primitive.kind.requires_postcondition() {
            debug!(
                primitive_kind = ?primitive.kind,
                "skipping capability memory: primitive is non-mutating"
            );
            return Ok(CapabilityMemoryResult::Skipped(
                CapabilityMemorySkipReason::NonMutatingPrimitive,
            ));
        }

        let capability_type = capability_type_label(primitive.kind);
        let Some(capability_identifier) = derive_capability_identifier(primitive) else {
            warn!(
                primitive_kind = ?primitive.kind,
                "skipping capability memory: missing capability identifier"
            );
            return Ok(CapabilityMemoryResult::Skipped(
                CapabilityMemorySkipReason::MissingIdentifier,
            ));
        };

        let selectors = extract_selectors(primitive, outcome).map(|value| sanitize_value(&value));
        let outcome_metadata = build_outcome_metadata(primitive, outcome);
        let cost_profile = extract_cost_profile(outcome);
        let anti_bot_notes = extract_anti_bot_notes(outcome);
        let summary = build_result_summary(&capability_identifier, executor_kind, primitive);

        let row = sqlx::query(
            r#"
            INSERT INTO capability_memories (
                subject_id,
                capability_type,
                capability_identifier,
                executor_kind,
                selectors,
                outcome_metadata,
                cost_profile,
                anti_bot_notes,
                result_summary,
                success_count,
                last_success_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10)
            ON CONFLICT (subject_id, capability_type, capability_identifier, executor_kind)
            DO UPDATE SET
                selectors = EXCLUDED.selectors,
                outcome_metadata = EXCLUDED.outcome_metadata,
                cost_profile = EXCLUDED.cost_profile,
                anti_bot_notes = EXCLUDED.anti_bot_notes,
                result_summary = EXCLUDED.result_summary,
                success_count = capability_memories.success_count + 1,
                last_success_at = EXCLUDED.last_success_at,
                updated_at = NOW()
            RETURNING success_count
            "#,
        )
        .bind(subject_id)
        .bind(capability_type)
        .bind(&capability_identifier)
        .bind(executor_kind)
        .bind(selectors.clone())
        .bind(outcome_metadata.clone())
        .bind(cost_profile.clone())
        .bind(anti_bot_notes.clone())
        .bind(summary.clone())
        .bind(occurred_at)
        .fetch_one(&self.pool)
        .await?;

        let success_count: i32 = row.try_get("success_count")?;
        let inserted = success_count == 1;

        let selector_keys = selectors
            .as_ref()
            .and_then(|value| value.as_object())
            .map(|object| object.keys().cloned().collect::<Vec<_>>());

        info!(
            capability_type,
            capability_identifier,
            %subject_id,
            executor_kind,
            success_count,
            inserted,
            selector_keys = ?selector_keys,
            "capability memory upserted"
        );

        let result = if inserted {
            CapabilityMemoryResult::Inserted { success_count }
        } else {
            CapabilityMemoryResult::Updated { success_count }
        };

        Ok(result)
    }
}

pub(crate) fn capability_type_label(kind: ActionPrimitiveKind) -> &'static str {
    match kind {
        ActionPrimitiveKind::Web => "web",
        ActionPrimitiveKind::Android => "android",
        ActionPrimitiveKind::Cli => "cli",
        ActionPrimitiveKind::Http => "http",
        ActionPrimitiveKind::Message => "message",
        ActionPrimitiveKind::Pay => "pay",
        ActionPrimitiveKind::Store => "store",
        ActionPrimitiveKind::Watch => "watch",
        ActionPrimitiveKind::Research => "research",
        ActionPrimitiveKind::Decide => "decide",
        ActionPrimitiveKind::Confirm => "confirm",
    }
}

pub(crate) fn derive_capability_identifier(primitive: &ActionPrimitive) -> Option<String> {
    if let Some(identifier) = primitive
        .args
        .get("capability_identifier")
        .and_then(Value::as_str)
    {
        return Some(identifier.to_string());
    }

    if let Some(vendor) = primitive.args.get("vendor").and_then(Value::as_str) {
        return Some(vendor.to_string());
    }

    if let Some(url_value) = primitive.args.get("url").and_then(Value::as_str)
        && let Ok(parsed) = Url::parse(url_value)
        && let Some(host) = parsed.host_str()
    {
        return Some(host.to_string());
    }

    if let Some(intent) = primitive.args.get("intent").and_then(Value::as_str) {
        return Some(intent.to_string());
    }

    None
}

fn extract_selectors(primitive: &ActionPrimitive, outcome: &Value) -> Option<Value> {
    const SELECTOR_KEYS: &[&str] = &["selectors", "selector_hints", "flow_hints"];
    for key in SELECTOR_KEYS {
        if let Some(value) = primitive.args.get(*key) {
            return Some(value.clone());
        }
    }

    outcome.get("selectors").cloned()
}

fn extract_cost_profile(outcome: &Value) -> Value {
    outcome
        .get("cost_profile")
        .map(sanitize_value)
        .unwrap_or_else(|| Value::Object(JsonMap::new()))
}

fn extract_anti_bot_notes(outcome: &Value) -> Value {
    outcome
        .get("anti_bot_notes")
        .map(sanitize_value)
        .unwrap_or_else(|| Value::Array(Vec::new()))
}

fn build_outcome_metadata(primitive: &ActionPrimitive, outcome: &Value) -> Value {
    let mut metadata = JsonMap::new();
    let postcondition = outcome
        .get("postcondition")
        .map(sanitize_value)
        .unwrap_or_else(|| sanitize_value(outcome));
    metadata.insert("postcondition".into(), postcondition);

    if let Some(intent) = primitive.args.get("intent").and_then(Value::as_str) {
        metadata.insert("intent".into(), Value::String(intent.to_string()));
    }

    if let Some(url) = primitive.args.get("url").and_then(Value::as_str)
        && let Some(url_metadata) = sanitize_url(url)
    {
        metadata.insert("url".into(), url_metadata);
    }

    if let Some(voice) = primitive_voice_rationale(primitive) {
        metadata.insert("voice_rationale".into(), Value::String(voice));
    }

    Value::Object(metadata)
}

fn primitive_voice_rationale(primitive: &ActionPrimitive) -> Option<String> {
    const VOICE_KEYS: &[&str] = &[
        "voice_rationale",
        "notes",
        "body",
        "prompt",
        "summary",
        "reason",
        "message",
    ];

    for key in VOICE_KEYS {
        if let Some(value) = primitive.args.get(*key).and_then(Value::as_str)
            && let Some(rationale) = sanitize_voice_for_log(value)
        {
            return Some(rationale);
        }
    }

    if let Some(intent) = primitive.args.get("intent").and_then(Value::as_str) {
        let friendly = intent.replace('_', " ");
        if let Some(rationale) = sanitize_voice_for_log(&friendly) {
            return Some(rationale);
        }
    }

    None
}

fn sanitize_voice_for_log(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if looks_sensitive(trimmed) {
        return Some("[redacted]".into());
    }

    Some(sanitize_detail(trimmed))
}

fn build_result_summary(
    capability_identifier: &str,
    executor_kind: &str,
    primitive: &ActionPrimitive,
) -> Option<String> {
    if let Some(intent) = primitive.args.get("intent").and_then(Value::as_str) {
        return Some(format!("{executor_kind} satisfied intent {intent}"));
    }
    Some(format!(
        "{executor_kind} succeeded for {capability_identifier}"
    ))
}

fn sanitize_url(raw: &str) -> Option<Value> {
    let parsed = Url::parse(raw).ok()?;
    let mut map = JsonMap::new();
    if let Some(host) = parsed.host_str() {
        map.insert("host".into(), Value::String(host.to_string()));
    }
    let path = parsed.path();
    if !path.is_empty() && path != "/" {
        map.insert("path".into(), Value::String(path.to_string()));
    }
    if map.is_empty() {
        None
    } else {
        Some(Value::Object(map))
    }
}

fn sanitize_value(value: &Value) -> Value {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => value.clone(),
        Value::String(text) => Value::String(sanitize_string(text)),
        Value::Array(items) => Value::Array(items.iter().map(sanitize_value).collect::<Vec<_>>()),
        Value::Object(map) => {
            let mut sanitized = JsonMap::new();
            for (key, val) in map {
                let lower_key = key.to_ascii_lowercase();
                if ALWAYS_REDACT_KEYS
                    .iter()
                    .any(|flag| lower_key.contains(flag))
                {
                    sanitized.insert(key.clone(), Value::String("[redacted]".into()));
                } else {
                    sanitized.insert(key.clone(), sanitize_value(val));
                }
            }
            Value::Object(sanitized)
        }
    }
}

fn sanitize_string(value: &str) -> String {
    if looks_sensitive(value) {
        "[redacted]".into()
    } else {
        value.to_string()
    }
}

fn looks_sensitive(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }

    if trimmed.len() > 128 {
        return true;
    }

    if trimmed.contains('@') {
        return true;
    }

    let digits_only = trimmed.chars().all(|ch| ch.is_ascii_digit());
    if digits_only && trimmed.len() >= 6 {
        return true;
    }

    let lowercase = trimmed.to_ascii_lowercase();
    if lowercase.starts_with("bearer ") || lowercase.starts_with("basic ") {
        return true;
    }

    false
}

const ALWAYS_REDACT_KEYS: &[&str] = &[
    "password",
    "passcode",
    "secret",
    "token",
    "otp",
    "auth",
    "credential",
    "cvv",
    "prefill",
];

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
    #[must_use]
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

    /// Create a planner event from an arbitrary payload.
    ///
    /// # Errors
    ///
    /// Returns [`EventLogError::Payload`] if the payload cannot be serialized to JSON.
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
    /// Establish a pooled connection to the event log database.
    ///
    /// # Errors
    ///
    /// Returns [`EventLogError::Database`] if the connection cannot be established.
    pub async fn connect(settings: EventLogSettings) -> Result<Self, EventLogError> {
        let pool = PgPoolOptions::new()
            .max_connections(settings.max_connections)
            .acquire_timeout(settings.connect_timeout)
            .connect(&settings.database_url)
            .await?;
        Ok(Self { pool })
    }

    #[must_use]
    pub fn from_pool(pool: PgPool) -> Self {
        Self { pool }
    }

    #[must_use]
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    #[instrument(skip_all)]
    /// Apply any pending schema migrations for the event log database.
    ///
    /// # Errors
    ///
    /// Returns [`EventLogError::Migration`] if migrations fail.
    /// Returns [`EventLogError::Database`] if the connection cannot run migrations.
    pub async fn migrate(&self) -> Result<(), EventLogError> {
        MIGRATOR.run(&self.pool).await?;
        Ok(())
    }

    #[instrument(skip_all, fields(replay_id = %event.replay_id, plan_id = %event.plan_id, step_index = event.step_index))]
    /// Append a planner event if the (plan, step) tuple has not yet been recorded.
    ///
    /// # Errors
    ///
    /// Returns [`EventLogError::InvalidStepIndex`] if the event has a negative step.
    /// Returns [`EventLogError::Database`] if the insert query fails.
    pub async fn append(&self, event: NewPlannerEvent) -> Result<AppendOutcome, EventLogError> {
        if event.step_index < 0 {
            return Err(EventLogError::InvalidStepIndex(event.step_index));
        }

        let row = sqlx::query(
            r#"
            INSERT INTO planner_events (replay_id, plan_id, step_index, occurred_at, action)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT DO NOTHING
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
    /// Fetch events for a plan ordered by ascending step index.
    ///
    /// # Errors
    ///
    /// Returns [`EventLogError::Database`] if the select query fails or any row cannot be decoded.
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
    #![allow(clippy::expect_used, clippy::unwrap_used)]

    use super::*;
    use serde_json::Value;
    use std::{convert::TryFrom, path::Path, sync::OnceLock};
    use testcontainers::{
        ContainerAsync, GenericImage, ImageExt,
        core::{IntoContainerPort, WaitFor},
        runners::AsyncRunner,
    };
    use tokio::{sync::Mutex, time::sleep};

    static DB_GUARD: OnceLock<Mutex<()>> = OnceLock::new();

    #[test]
    fn derive_identifier_falls_back_for_hostless_url() {
        let mut args = JsonMap::new();
        args.insert(
            "url".into(),
            Value::String("mailto:alex@example.com".into()),
        );
        args.insert("intent".into(), Value::String("book_call".into()));

        let primitive = ActionPrimitive::new(ActionPrimitiveKind::Web, args);
        assert_eq!(
            derive_capability_identifier(&primitive),
            Some("book_call".to_string())
        );
    }

    #[test]
    fn derive_identifier_falls_back_when_url_invalid() {
        let mut args = JsonMap::new();
        args.insert("url".into(), Value::String("/relative/path".into()));
        args.insert("intent".into(), Value::String("book_call".into()));

        let primitive = ActionPrimitive::new(ActionPrimitiveKind::Web, args);
        assert_eq!(
            derive_capability_identifier(&primitive),
            Some("book_call".to_string())
        );
    }

    const POSTGRES_IMAGE: &str = "pgvector/pgvector";
    const POSTGRES_TAG: &str = "pg16";
    const POSTGRES_USER: &str = "tyrum";
    const POSTGRES_PASSWORD: &str = "tyrum_dev_password";
    const POSTGRES_DB: &str = "tyrum_dev";

    fn docker_available() -> bool {
        std::env::var("DOCKER_HOST").is_ok()
            || std::env::var("TESTCONTAINERS_HOST_OVERRIDE").is_ok()
            || Path::new("/var/run/docker.sock").exists()
    }

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
        if !docker_available() {
            eprintln!("skipping append_inserts_event: docker unavailable");
            return;
        }
        let _guard = DB_GUARD.get_or_init(|| Mutex::new(())).lock().await;
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
        if !docker_available() {
            eprintln!("skipping append_is_idempotent: docker unavailable");
            return;
        }
        let _guard = DB_GUARD.get_or_init(|| Mutex::new(())).lock().await;
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
    async fn duplicate_plan_step_returns_duplicate() {
        if !docker_available() {
            eprintln!("skipping duplicate_plan_step_returns_duplicate: docker unavailable");
            return;
        }
        let _guard = DB_GUARD.get_or_init(|| Mutex::new(())).lock().await;
        let (container, event_log) = setup().await;
        let _container = container;
        let plan_id = Uuid::new_v4();

        let first = new_event(plan_id, 2);
        assert!(matches!(
            event_log.append(first).await.unwrap(),
            AppendOutcome::Inserted(_)
        ));

        let second = new_event(plan_id, 2);
        assert!(matches!(
            event_log.append(second).await.unwrap(),
            AppendOutcome::Duplicate
        ));

        let events = event_log.events_for_plan(plan_id).await.unwrap();
        assert_eq!(events.len(), 1);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn events_are_ordered_by_step() {
        if !docker_available() {
            eprintln!("skipping events_are_ordered_by_step: docker unavailable");
            return;
        }
        let _guard = DB_GUARD.get_or_init(|| Mutex::new(())).lock().await;
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
            let expected_step_i32 = i32::try_from(expected_step).expect("step index fits in i32");
            assert_eq!(event.step_index, expected_step_i32);
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn reject_negative_steps() {
        if !docker_available() {
            eprintln!("skipping reject_negative_steps: docker unavailable");
            return;
        }
        let _guard = DB_GUARD.get_or_init(|| Mutex::new(())).lock().await;
        let (container, event_log) = setup().await;
        let _container = container;
        let plan_id = Uuid::new_v4();
        let mut event = new_event(plan_id, 0);
        event.step_index = -1;
        let outcome = event_log.append(event).await;
        assert!(matches!(outcome, Err(EventLogError::InvalidStepIndex(-1))));
    }
}
