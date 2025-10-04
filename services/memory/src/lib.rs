use std::fmt;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{
    PgPool, Row,
    postgres::{PgPoolOptions, PgRow},
};
use thiserror::Error;
use uuid::Uuid;

/// Domain error type for memory data access operations.
#[derive(Debug, Error)]
pub enum MemoryError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("{entity} {id} not found")]
    NotFound { entity: &'static str, id: String },
}

impl MemoryError {
    fn not_found(entity: &'static str, id: impl fmt::Display) -> Self {
        MemoryError::NotFound {
            entity,
            id: id.to_string(),
        }
    }
}

/// High-level entry point for interacting with Tyrum memory stores.
#[derive(Clone)]
pub struct MemoryDal {
    pool: PgPool,
}

impl MemoryDal {
    /// Establish a new connection pool and wrap it in a [`MemoryDal`].
    pub async fn connect(database_url: &str) -> Result<Self, MemoryError> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;
        Ok(Self { pool })
    }

    /// Construct a DAL from an existing [`PgPool`].
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Access the underlying [`PgPool`].
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    // --- Fact operations ---------------------------------------------------

    pub async fn create_fact(&self, new_fact: NewFact) -> Result<Fact, MemoryError> {
        let record = sqlx::query_as::<_, Fact>(
            r#"
            INSERT INTO facts (
                subject_id,
                fact_key,
                fact_value,
                source,
                observed_at,
                confidence
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, subject_id, fact_key, fact_value, source, observed_at, confidence, created_at
            "#,
        )
        .bind(new_fact.subject_id)
        .bind(new_fact.fact_key)
        .bind(new_fact.fact_value)
        .bind(new_fact.source)
        .bind(new_fact.observed_at)
        .bind(new_fact.confidence)
        .fetch_one(&self.pool)
        .await?;

        Ok(record)
    }

    pub async fn get_fact(&self, fact_id: i64) -> Result<Option<Fact>, MemoryError> {
        let record = sqlx::query_as::<_, Fact>(
            r#"
            SELECT id, subject_id, fact_key, fact_value, source, observed_at, confidence, created_at
            FROM facts
            WHERE id = $1
            "#,
        )
        .bind(fact_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(record)
    }

    pub async fn list_facts_for_subject(&self, subject_id: Uuid) -> Result<Vec<Fact>, MemoryError> {
        let records = sqlx::query_as::<_, Fact>(
            r#"
            SELECT id, subject_id, fact_key, fact_value, source, observed_at, confidence, created_at
            FROM facts
            WHERE subject_id = $1
            ORDER BY observed_at DESC, id DESC
            "#,
        )
        .bind(subject_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(records)
    }

    pub async fn update_fact(
        &self,
        fact_id: i64,
        changes: FactChanges,
    ) -> Result<Fact, MemoryError> {
        let record = sqlx::query_as::<_, Fact>(
            r#"
            UPDATE facts
            SET fact_value = $1,
                source = $2,
                observed_at = $3,
                confidence = $4
            WHERE id = $5
            RETURNING id, subject_id, fact_key, fact_value, source, observed_at, confidence, created_at
            "#,
        )
        .bind(changes.fact_value)
        .bind(changes.source)
        .bind(changes.observed_at)
        .bind(changes.confidence)
        .bind(fact_id)
        .fetch_optional(&self.pool)
        .await?;

        record.ok_or_else(|| MemoryError::not_found("fact", fact_id))
    }

    pub async fn delete_fact(&self, fact_id: i64) -> Result<(), MemoryError> {
        let rows = sqlx::query("DELETE FROM facts WHERE id = $1")
            .bind(fact_id)
            .execute(&self.pool)
            .await?;

        if rows.rows_affected() == 0 {
            return Err(MemoryError::not_found("fact", fact_id));
        }

        Ok(())
    }

    // --- Episodic event operations ----------------------------------------

    pub async fn create_episodic_event(
        &self,
        new_event: NewEpisodicEvent,
    ) -> Result<EpisodicEvent, MemoryError> {
        let record = sqlx::query_as::<_, EpisodicEvent>(
            r#"
            INSERT INTO episodic_events (
                subject_id,
                event_id,
                occurred_at,
                channel,
                event_type,
                payload
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, subject_id, event_id, occurred_at, channel, event_type, payload, created_at
            "#,
        )
        .bind(new_event.subject_id)
        .bind(new_event.event_id)
        .bind(new_event.occurred_at)
        .bind(new_event.channel)
        .bind(new_event.event_type)
        .bind(new_event.payload)
        .fetch_one(&self.pool)
        .await?;

        Ok(record)
    }

    pub async fn get_episodic_event(
        &self,
        event_id: Uuid,
    ) -> Result<Option<EpisodicEvent>, MemoryError> {
        let record = sqlx::query_as::<_, EpisodicEvent>(
            r#"
            SELECT id, subject_id, event_id, occurred_at, channel, event_type, payload, created_at
            FROM episodic_events
            WHERE event_id = $1
            "#,
        )
        .bind(event_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(record)
    }

    pub async fn list_episodic_events_for_subject(
        &self,
        subject_id: Uuid,
    ) -> Result<Vec<EpisodicEvent>, MemoryError> {
        let records = sqlx::query_as::<_, EpisodicEvent>(
            r#"
            SELECT id, subject_id, event_id, occurred_at, channel, event_type, payload, created_at
            FROM episodic_events
            WHERE subject_id = $1
            ORDER BY occurred_at DESC, id DESC
            "#,
        )
        .bind(subject_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(records)
    }

    pub async fn update_episodic_event(
        &self,
        event_id: Uuid,
        changes: EpisodicEventChanges,
    ) -> Result<EpisodicEvent, MemoryError> {
        let record = sqlx::query_as::<_, EpisodicEvent>(
            r#"
            UPDATE episodic_events
            SET occurred_at = $1,
                channel = $2,
                event_type = $3,
                payload = $4
            WHERE event_id = $5
            RETURNING id, subject_id, event_id, occurred_at, channel, event_type, payload, created_at
            "#,
        )
        .bind(changes.occurred_at)
        .bind(changes.channel)
        .bind(changes.event_type)
        .bind(changes.payload)
        .bind(event_id)
        .fetch_optional(&self.pool)
        .await?;

        record.ok_or_else(|| MemoryError::not_found("episodic_event", event_id))
    }

    pub async fn delete_episodic_event(&self, event_id: Uuid) -> Result<(), MemoryError> {
        let rows = sqlx::query("DELETE FROM episodic_events WHERE event_id = $1")
            .bind(event_id)
            .execute(&self.pool)
            .await?;

        if rows.rows_affected() == 0 {
            return Err(MemoryError::not_found("episodic_event", event_id));
        }

        Ok(())
    }

    // --- Vector embedding operations --------------------------------------

    pub async fn create_vector_embedding(
        &self,
        new_embedding: NewVectorEmbedding,
    ) -> Result<VectorEmbedding, MemoryError> {
        let record = sqlx::query_as::<_, VectorEmbedding>(
            r#"
            INSERT INTO vector_embeddings (
                subject_id,
                embedding_id,
                embedding,
                embedding_model,
                label,
                metadata
            )
            VALUES ($1, $2, $3::vector, $4, $5, $6)
            RETURNING id, subject_id, embedding_id,
                embedding::float4[] AS embedding_components,
                embedding_model, label, metadata, created_at
            "#,
        )
        .bind(new_embedding.subject_id)
        .bind(new_embedding.embedding_id)
        .bind(vector_literal(&new_embedding.embedding))
        .bind(new_embedding.embedding_model)
        .bind(new_embedding.label)
        .bind(new_embedding.metadata)
        .fetch_one(&self.pool)
        .await?;

        Ok(record)
    }

    pub async fn get_vector_embedding(
        &self,
        embedding_id: Uuid,
    ) -> Result<Option<VectorEmbedding>, MemoryError> {
        let record = sqlx::query_as::<_, VectorEmbedding>(
            r#"
            SELECT id, subject_id, embedding_id,
                embedding::float4[] AS embedding_components,
                embedding_model, label, metadata, created_at
            FROM vector_embeddings
            WHERE embedding_id = $1
            "#,
        )
        .bind(embedding_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(record)
    }

    pub async fn list_vector_embeddings_for_subject(
        &self,
        subject_id: Uuid,
    ) -> Result<Vec<VectorEmbedding>, MemoryError> {
        let records = sqlx::query_as::<_, VectorEmbedding>(
            r#"
            SELECT id, subject_id, embedding_id,
                embedding::float4[] AS embedding_components,
                embedding_model, label, metadata, created_at
            FROM vector_embeddings
            WHERE subject_id = $1
            ORDER BY created_at DESC, id DESC
            "#,
        )
        .bind(subject_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(records)
    }

    pub async fn update_vector_embedding(
        &self,
        embedding_id: Uuid,
        changes: VectorEmbeddingChanges,
    ) -> Result<VectorEmbedding, MemoryError> {
        let record = sqlx::query_as::<_, VectorEmbedding>(
            r#"
            UPDATE vector_embeddings
            SET embedding = $1::vector,
                embedding_model = $2,
                label = $3,
                metadata = $4
            WHERE embedding_id = $5
            RETURNING id, subject_id, embedding_id,
                embedding::float4[] AS embedding_components,
                embedding_model, label, metadata, created_at
            "#,
        )
        .bind(vector_literal(&changes.embedding))
        .bind(changes.embedding_model)
        .bind(changes.label)
        .bind(changes.metadata)
        .bind(embedding_id)
        .fetch_optional(&self.pool)
        .await?;

        record.ok_or_else(|| MemoryError::not_found("vector_embedding", embedding_id))
    }

    pub async fn delete_vector_embedding(&self, embedding_id: Uuid) -> Result<(), MemoryError> {
        let rows = sqlx::query("DELETE FROM vector_embeddings WHERE embedding_id = $1")
            .bind(embedding_id)
            .execute(&self.pool)
            .await?;

        if rows.rows_affected() == 0 {
            return Err(MemoryError::not_found("vector_embedding", embedding_id));
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow, PartialEq)]
pub struct Fact {
    pub id: i64,
    pub subject_id: Uuid,
    pub fact_key: String,
    pub fact_value: serde_json::Value,
    pub source: String,
    pub observed_at: DateTime<Utc>,
    pub confidence: f32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct NewFact {
    pub subject_id: Uuid,
    pub fact_key: String,
    pub fact_value: serde_json::Value,
    pub source: String,
    pub observed_at: DateTime<Utc>,
    pub confidence: f32,
}

#[derive(Debug, Clone)]
pub struct FactChanges {
    pub fact_value: serde_json::Value,
    pub source: String,
    pub observed_at: DateTime<Utc>,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow, PartialEq)]
pub struct EpisodicEvent {
    pub id: i64,
    pub subject_id: Uuid,
    pub event_id: Uuid,
    pub occurred_at: DateTime<Utc>,
    pub channel: String,
    pub event_type: String,
    pub payload: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct NewEpisodicEvent {
    pub subject_id: Uuid,
    pub event_id: Uuid,
    pub occurred_at: DateTime<Utc>,
    pub channel: String,
    pub event_type: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct EpisodicEventChanges {
    pub occurred_at: DateTime<Utc>,
    pub channel: String,
    pub event_type: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VectorEmbedding {
    pub id: i64,
    pub subject_id: Uuid,
    pub embedding_id: Uuid,
    pub embedding: Vec<f32>,
    pub embedding_model: String,
    pub label: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct NewVectorEmbedding {
    pub subject_id: Uuid,
    pub embedding_id: Uuid,
    pub embedding: Vec<f32>,
    pub embedding_model: String,
    pub label: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct VectorEmbeddingChanges {
    pub embedding: Vec<f32>,
    pub embedding_model: String,
    pub label: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

impl<'r> sqlx::FromRow<'r, PgRow> for VectorEmbedding {
    fn from_row(row: &'r PgRow) -> Result<Self, sqlx::Error> {
        Ok(Self {
            id: row.try_get("id")?,
            subject_id: row.try_get("subject_id")?,
            embedding_id: row.try_get("embedding_id")?,
            embedding: row.try_get("embedding_components")?,
            embedding_model: row.try_get("embedding_model")?,
            label: row.try_get("label")?,
            metadata: row.try_get("metadata")?,
            created_at: row.try_get("created_at")?,
        })
    }
}

impl fmt::Display for VectorEmbedding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "VectorEmbedding {{ embedding_id: {}, model: {}, dims: {}, label: {:?} }}",
            self.embedding_id,
            self.embedding_model,
            self.embedding.len(),
            self.label
        )
    }
}

impl fmt::Display for Fact {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Fact {{ id: {}, key: {} }}", self.id, self.fact_key)
    }
}

impl fmt::Display for EpisodicEvent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "EpisodicEvent {{ event_id: {}, type: {} }}",
            self.event_id, self.event_type
        )
    }
}

fn vector_literal(components: &[f32]) -> String {
    let parts: Vec<String> = components
        .iter()
        .map(|component| component.to_string())
        .collect();
    format!("[{}]", parts.join(", "))
}
