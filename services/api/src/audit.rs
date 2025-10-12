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

            let voice_rationale = extract_voice_rationale(&action);

            events.push(PlanAuditEvent {
                replay_id,
                step_index,
                occurred_at,
                recorded_at,
                action,
                voice_rationale,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice_rationale: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub redactions: Vec<String>,
}

fn collect_redactions(action: &Value) -> Vec<String> {
    let mut paths = Vec::new();
    let mut segments = vec!["action".to_string()];
    collect_redactions_inner(action, &mut segments, &mut paths);
    paths
}

fn extract_voice_rationale(value: &Value) -> Option<String> {
    match value {
        Value::Object(map) => {
            if let Some(voice) = map.get("voice_rationale").and_then(Value::as_str)
                && let Some(cleaned) = clean_voice_string(voice)
            {
                return Some(cleaned);
            }

            if let Some(steps) = map.get("steps").and_then(Value::as_array) {
                let voices: Vec<String> =
                    steps.iter().filter_map(extract_voice_rationale).collect();
                if !voices.is_empty() {
                    return Some(voices.join(" • "));
                }
            }

            for (key, nested) in map {
                if key == "steps" {
                    continue;
                }
                if let Some(voice) = extract_voice_rationale(nested) {
                    return Some(voice);
                }
            }
        }
        Value::Array(items) => {
            let voices: Vec<String> = items.iter().filter_map(extract_voice_rationale).collect();
            if !voices.is_empty() {
                return Some(voices.join(" • "));
            }
        }
        _ => {}
    }

    None
}

fn clean_voice_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn extract_voice_rationale_prefers_top_level_field() {
        let action = json!({ "voice_rationale": "Executor completed successfully." });
        assert_eq!(
            super::extract_voice_rationale(&action),
            Some("Executor completed successfully.".into())
        );
    }

    #[test]
    fn extract_voice_rationale_joins_step_rationales() {
        let action = json!({
            "outcome": {
                "status": "success",
                "steps": [
                    { "voice_rationale": "Collected context." },
                    { "voice_rationale": "Executed capability." }
                ]
            }
        });

        assert_eq!(
            super::extract_voice_rationale(&action),
            Some("Collected context. • Executed capability.".into())
        );
    }
}
