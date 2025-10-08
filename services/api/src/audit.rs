use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{PgPool, Row};
use thiserror::Error;
use uuid::Uuid;

/// Repository that exposes read-only access to planner audit timelines.
#[derive(Clone)]
pub struct AuditTimelineRepository {
    pool: PgPool,
}

impl AuditTimelineRepository {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    #[must_use]
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Fetch ordered planner events for a plan and surface redaction metadata.
    ///
    /// # Errors
    ///
    /// Returns [`AuditTimelineError::NotFound`] when the plan has no recorded events.
    /// Returns [`AuditTimelineError::Database`] if the underlying query fails.
    pub async fn fetch_plan_timeline(
        &self,
        plan_id: Uuid,
    ) -> Result<AuditTimelineResponse, AuditTimelineError> {
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
        .await
        .map_err(AuditTimelineError::Database)?;

        if rows.is_empty() {
            return Err(AuditTimelineError::NotFound(plan_id));
        }

        let mut has_redactions = false;
        let mut events = Vec::with_capacity(rows.len());

        for row in rows {
            let replay_id: Uuid = row.try_get("replay_id")?;
            let step_index: i32 = row.try_get("step_index")?;
            let occurred_at: DateTime<Utc> = row.try_get("occurred_at")?;
            let recorded_at: DateTime<Utc> = row.try_get("created_at")?;
            let action: Value = row.try_get("action")?;

            let redactions = collect_redactions(&action);
            if !redactions.is_empty() {
                has_redactions = true;
            }

            events.push(PlanAuditEvent {
                replay_id,
                step_index,
                occurred_at,
                recorded_at,
                action,
                redactions,
            });
        }

        Ok(AuditTimelineResponse {
            plan_id,
            generated_at: Utc::now(),
            event_count: events.len(),
            has_redactions,
            events,
        })
    }
}

#[derive(Debug, Error)]
pub enum AuditTimelineError {
    #[error("audit timeline not found for plan {0}")]
    NotFound(Uuid),
    #[error("audit timeline query failed: {0}")]
    Database(#[from] sqlx::Error),
}

#[derive(Debug, Serialize)]
pub struct AuditTimelineResponse {
    pub plan_id: Uuid,
    pub generated_at: DateTime<Utc>,
    pub event_count: usize,
    pub has_redactions: bool,
    pub events: Vec<PlanAuditEvent>,
}

#[derive(Debug, Serialize)]
pub struct PlanAuditEvent {
    pub replay_id: Uuid,
    pub step_index: i32,
    pub occurred_at: DateTime<Utc>,
    #[serde(rename = "recorded_at")]
    pub recorded_at: DateTime<Utc>,
    pub action: Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub redactions: Vec<String>,
}

fn collect_redactions(action: &Value) -> Vec<String> {
    let mut paths = Vec::new();
    let mut segments = vec!["action".to_string()];
    collect_redactions_inner(action, &mut segments, &mut paths);
    paths
}

fn collect_redactions_inner(value: &Value, path: &mut Vec<String>, acc: &mut Vec<String>) {
    match value {
        Value::String(text) if text == "[redacted]" => {
            acc.push(format_pointer(path));
        }
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                path.push(index.to_string());
                collect_redactions_inner(item, path, acc);
                path.pop();
            }
        }
        Value::Object(map) => {
            for (key, item) in map {
                path.push(key.clone());
                collect_redactions_inner(item, path, acc);
                path.pop();
            }
        }
        _ => {}
    }
}

fn format_pointer(segments: &[String]) -> String {
    let mut pointer = String::new();
    for segment in segments {
        pointer.push('/');
        pointer.push_str(&escape_pointer_segment(segment));
    }
    pointer
}

fn escape_pointer_segment(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}
