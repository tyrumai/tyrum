use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use thiserror::Error;
use uuid::Uuid;

use crate::metrics::CacheKind;

#[derive(Debug, Error)]
pub enum CapabilityError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

#[derive(Clone)]
pub struct CapabilityRepository {
    pool: PgPool,
}

impl CapabilityRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub async fn fetch(
        &self,
        key: &CapabilityCacheKey,
    ) -> Result<Option<CapabilityRecord>, CapabilityError> {
        let record = sqlx::query_as::<_, CapabilityRecord>(
            r#"
            SELECT
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
                last_success_at,
                updated_at
            FROM capability_memories
            WHERE subject_id = $1
              AND capability_type = $2
              AND capability_identifier = $3
              AND executor_kind = $4
            "#,
        )
        .bind(key.subject_id)
        .bind(&key.capability_type)
        .bind(&key.capability_identifier)
        .bind(&key.executor_kind)
        .fetch_optional(&self.pool)
        .await?;

        Ok(record)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSchemaResponse {
    pub subject_id: Uuid,
    pub capability_type: String,
    pub capability_identifier: String,
    pub executor_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selectors: Option<Value>,
    pub outcome_metadata: Value,
    pub cost_profile: Value,
    pub anti_bot_notes: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_summary: Option<String>,
    pub success_count: i32,
    pub last_success_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCostResponse {
    pub subject_id: Uuid,
    pub capability_type: String,
    pub capability_identifier: String,
    pub executor_kind: String,
    pub cost: CostBreakdown,
    pub success_count: i32,
    pub last_success_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostBreakdown {
    pub amount_minor_units: i64,
    pub currency: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct CapabilityCacheKey {
    pub subject_id: Uuid,
    pub capability_type: String,
    pub capability_identifier: String,
    pub executor_kind: String,
}

impl CapabilityCacheKey {
    pub fn redis_key(&self, namespace: &str, kind: CacheKind) -> String {
        format!(
            "{namespace}:capability:{}:{}:{}:{}:{}",
            kind.as_str(),
            self.subject_id,
            sanitize_segment(&self.capability_type),
            sanitize_segment(&self.capability_identifier),
            sanitize_segment(&self.executor_kind),
        )
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct CapabilityRecord {
    pub subject_id: Uuid,
    pub capability_type: String,
    pub capability_identifier: String,
    pub executor_kind: String,
    pub selectors: Option<Value>,
    pub outcome_metadata: Value,
    pub cost_profile: Value,
    pub anti_bot_notes: Value,
    pub result_summary: Option<String>,
    pub success_count: i32,
    pub last_success_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl CapabilityRecord {
    pub fn into_schema_response(self) -> ToolSchemaResponse {
        ToolSchemaResponse {
            subject_id: self.subject_id,
            capability_type: self.capability_type,
            capability_identifier: self.capability_identifier,
            executor_kind: self.executor_kind,
            selectors: self.selectors,
            outcome_metadata: self.outcome_metadata,
            cost_profile: self.cost_profile,
            anti_bot_notes: self.anti_bot_notes,
            result_summary: self.result_summary,
            success_count: self.success_count,
            last_success_at: self.last_success_at,
            updated_at: self.updated_at,
        }
    }

    pub fn into_cost_response(self) -> Option<ToolCostResponse> {
        let cost = extract_cost_from_profile(&self.cost_profile)
            .or_else(|| extract_cost(&self.outcome_metadata))?;
        Some(ToolCostResponse {
            subject_id: self.subject_id,
            capability_type: self.capability_type,
            capability_identifier: self.capability_identifier,
            executor_kind: self.executor_kind,
            cost,
            success_count: self.success_count,
            last_success_at: self.last_success_at,
        })
    }
}

fn extract_cost(outcome: &Value) -> Option<CostBreakdown> {
    let cost = outcome.get("cost")?;
    let currency = cost.get("currency")?.as_str()?.to_string();
    let amount_minor_units = cost
        .get("amount_minor_units")
        .and_then(Value::as_i64)
        .or_else(|| {
            cost.get("amount_minor_units")
                .and_then(Value::as_u64)
                .and_then(|value| i64::try_from(value).ok())
        })?;

    let observed_at = cost
        .get("observed_at")
        .and_then(Value::as_str)
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|dt| dt.with_timezone(&Utc));

    Some(CostBreakdown {
        amount_minor_units,
        currency,
        observed_at,
    })
}

fn extract_cost_from_profile(profile: &Value) -> Option<CostBreakdown> {
    let cost = profile.as_object()?;
    if cost.is_empty() {
        return None;
    }

    let currency = cost.get("currency")?.as_str()?.to_string();
    let amount_minor_units = cost
        .get("amount_minor_units")
        .and_then(Value::as_i64)
        .or_else(|| {
            cost.get("amount_minor_units")
                .and_then(Value::as_u64)
                .and_then(|value| i64::try_from(value).ok())
        })?;

    let observed_at = cost
        .get("observed_at")
        .and_then(Value::as_str)
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|dt| dt.with_timezone(&Utc));

    Some(CostBreakdown {
        amount_minor_units,
        currency,
        observed_at,
    })
}

fn sanitize_segment(segment: &str) -> String {
    segment
        .chars()
        .map(|ch| match ch {
            ' ' | '\n' | '\r' | '\t' => '_',
            ':' | '|' => '-',
            other => other,
        })
        .collect()
}
