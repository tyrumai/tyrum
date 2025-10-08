use std::{borrow::Cow, collections::BTreeSet};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::PgPool;
use thiserror::Error;
use validator::{Validate, ValidationError, ValidationErrors};

/// Route constant for watcher registrations.
pub const WATCHERS_ROUTE: &str = "/watchers";

/// Event sources currently accepted for watcher registrations.
pub const ALLOWED_EVENT_SOURCES: &[&str] = &[
    "email", "messages", "calls", "calendar", "files", "webhooks", "custom",
];

/// Persisted watcher definition as stored within the Tyrum API database.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct WatcherRecord {
    pub id: i64,
    pub event_source: String,
    pub predicate: String,
    pub plan_reference: String,
    pub status: String,
    pub metadata: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// API payload submitted by clients when registering a watcher.
#[derive(Debug, Clone, Deserialize, Validate)]
pub struct WatcherRegistrationRequest {
    #[serde(default)]
    #[validate(
        length(min = 1, max = 64),
        custom(function = "validate_event_source_field")
    )]
    pub event_source: String,
    #[serde(default)]
    #[validate(
        length(min = 1, max = 2048),
        custom(function = "validate_predicate_field")
    )]
    pub predicate: String,
    #[serde(default)]
    #[validate(
        length(min = 1, max = 128),
        custom(function = "validate_plan_reference_field")
    )]
    pub plan_reference: String,
    #[serde(default = "default_metadata_value")]
    #[validate(custom(function = "validate_metadata_field"))]
    pub metadata: Value,
}

impl WatcherRegistrationRequest {
    /// Normalizes payload fields prior to validation/persistence.
    pub fn sanitize(&mut self) {
        self.event_source = normalize_event_source(&self.event_source);
        self.predicate = self.predicate.trim().to_string();
        self.plan_reference = self.plan_reference.trim().to_string();
    }
}

/// API response returned to clients after a registration attempt.
#[derive(Debug, Clone, Serialize)]
pub struct WatcherRegistrationResponse {
    pub status: &'static str,
    pub watcher: WatcherResponse,
}

/// Representation of a watcher returned in API responses.
#[derive(Debug, Clone, Serialize)]
pub struct WatcherResponse {
    pub id: i64,
    pub event_source: String,
    pub predicate: String,
    pub plan_reference: String,
    pub status: String,
    pub metadata: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<WatcherRecord> for WatcherResponse {
    fn from(record: WatcherRecord) -> Self {
        Self {
            id: record.id,
            event_source: record.event_source,
            predicate: record.predicate,
            plan_reference: record.plan_reference,
            status: record.status,
            metadata: record.metadata,
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}

/// Payload used when creating a new watcher registration.
#[derive(Debug, Clone)]
pub struct NewWatcher {
    pub event_source: String,
    pub predicate: String,
    pub plan_reference: String,
    pub status: String,
    pub metadata: Value,
}

impl NewWatcher {
    pub fn active(
        event_source: String,
        predicate: String,
        plan_reference: String,
        metadata: Value,
    ) -> Self {
        Self {
            event_source,
            predicate,
            plan_reference,
            status: "active".to_string(),
            metadata,
        }
    }
}

/// Errors returned when persisting watcher registrations.
#[derive(Debug, Error)]
pub enum WatcherRepositoryError {
    #[error("watcher with the same event source, predicate, and plan reference already exists")]
    Duplicate,
    #[error("database error: {0}")]
    Database(sqlx::Error),
}

impl From<sqlx::Error> for WatcherRepositoryError {
    fn from(error: sqlx::Error) -> Self {
        if let sqlx::Error::Database(db_err) = &error
            && db_err.constraint() == Some("watchers_event_predicate_plan_unique")
        {
            WatcherRepositoryError::Duplicate
        } else {
            WatcherRepositoryError::Database(error)
        }
    }
}

/// Repository for storing and retrieving watcher registrations.
#[derive(Clone)]
pub struct WatcherRepository {
    pool: PgPool,
}

impl WatcherRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Inserts a new watcher registration and returns the stored record.
    pub async fn insert(
        &self,
        watcher: &NewWatcher,
    ) -> Result<WatcherRecord, WatcherRepositoryError> {
        let record = sqlx::query_as::<_, WatcherRecord>(
            r#"
            INSERT INTO watchers (event_source, predicate, plan_reference, status, metadata)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, event_source, predicate, plan_reference, status, metadata, created_at, updated_at
            "#,
        )
        .bind(&watcher.event_source)
        .bind(&watcher.predicate)
        .bind(&watcher.plan_reference)
        .bind(&watcher.status)
        .bind(&watcher.metadata)
        .fetch_one(&self.pool)
        .await?;

        Ok(record)
    }
}

/// Returns the supplied event source lowercased and trimmed.
pub fn normalize_event_source(raw: &str) -> String {
    raw.trim().to_ascii_lowercase()
}

/// Returns `true` when the supplied event source is one of the supported values.
pub fn is_allowed_event_source(candidate: &str) -> bool {
    let normalized = normalize_event_source(candidate);
    ALLOWED_EVENT_SOURCES.contains(&normalized.as_str())
}

/// Returns `true` when the metadata value is a JSON object.
pub fn metadata_is_object(metadata: &Value) -> bool {
    matches!(metadata, Value::Object(_))
}

/// Collects the allowed event sources for human-friendly responses.
pub fn allowed_event_sources() -> BTreeSet<&'static str> {
    ALLOWED_EVENT_SOURCES.iter().copied().collect()
}

fn default_metadata_value() -> Value {
    Value::Object(Map::new())
}

fn validate_event_source_field(value: &str) -> Result<(), ValidationError> {
    if is_allowed_event_source(value) {
        return Ok(());
    }

    let mut error = ValidationError::new("unsupported_event_source");
    error.add_param(Cow::Borrowed("value"), &value);
    let allowed: Vec<_> = allowed_event_sources().into_iter().collect();
    error.add_param(Cow::Borrowed("allowed"), &allowed);
    Err(error)
}

fn validate_predicate_field(value: &str) -> Result<(), ValidationError> {
    if value.is_empty() {
        return Err(ValidationError::new("empty_predicate"));
    }

    if value
        .chars()
        .all(|ch| matches!(ch, '\n' | '\r' | '\t') || !ch.is_control())
    {
        Ok(())
    } else {
        Err(ValidationError::new("invalid_predicate"))
    }
}

fn validate_plan_reference_field(value: &str) -> Result<(), ValidationError> {
    if value.is_empty() {
        return Err(ValidationError::new("empty_plan_reference"));
    }

    let allowed = value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '/' | ':' | '.' | '#'));
    if allowed {
        Ok(())
    } else {
        Err(ValidationError::new("invalid_plan_reference"))
    }
}

fn validate_metadata_field(value: &Value) -> Result<(), ValidationError> {
    if metadata_is_object(value) {
        Ok(())
    } else {
        Err(ValidationError::new("metadata_not_object"))
    }
}

/// Converts validation errors into a human-readable message.
pub fn watcher_validation_message(errors: &ValidationErrors) -> String {
    if errors
        .field_errors()
        .get("event_source")
        .is_some_and(|field_errors| {
            field_errors
                .iter()
                .any(|err| err.code == "unsupported_event_source")
        })
    {
        let allowed: Vec<_> = allowed_event_sources().into_iter().collect();
        return format!("event_source must be one of: {}", allowed.join(", "));
    }

    errors.to_string()
}

/// Resulting error from attempting to register a new watcher.
#[derive(Debug, Error)]
pub enum RegisterWatcherError {
    #[error("invalid watcher registration payload: {message}")]
    Validation {
        message: String,
        #[source]
        errors: ValidationErrors,
    },
    #[error("watcher already registered with the same definition")]
    Duplicate,
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

impl RegisterWatcherError {
    /// Human-friendly validation message when validation fails.
    pub fn validation_message(&self) -> Option<&str> {
        match self {
            RegisterWatcherError::Validation { message, .. } => Some(message),
            _ => None,
        }
    }
}

/// Sanitizes, validates, and persists a watcher registration, returning an API response payload.
pub async fn process_registration(
    repository: &WatcherRepository,
    mut payload: WatcherRegistrationRequest,
) -> Result<WatcherResponse, RegisterWatcherError> {
    payload.sanitize();

    if let Err(errors) = payload.validate() {
        let message = watcher_validation_message(&errors);
        return Err(RegisterWatcherError::Validation { message, errors });
    }

    let WatcherRegistrationRequest {
        event_source,
        predicate,
        plan_reference,
        metadata,
    } = payload;

    let new_watcher = NewWatcher::active(event_source, predicate, plan_reference, metadata);

    match repository.insert(&new_watcher).await {
        Ok(record) => Ok(WatcherResponse::from(record)),
        Err(WatcherRepositoryError::Duplicate) => Err(RegisterWatcherError::Duplicate),
        Err(WatcherRepositoryError::Database(error)) => Err(RegisterWatcherError::Database(error)),
    }
}
