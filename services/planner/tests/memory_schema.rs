mod common;

use chrono::Utc;
use common::postgres::TestPostgres;
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

#[tokio::test(flavor = "current_thread")]
async fn pgvector_extension_supports_embedding_roundtrip() {
    let postgres = TestPostgres::start()
        .await
        .expect("start postgres container");
    let pool = postgres.pool().clone();

    MIGRATOR.run(&pool).await.expect("run migrations");

    let subject_id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO facts (subject_id, fact_key, fact_value, source, observed_at)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(subject_id)
    .bind("preferred_greeting")
    .bind(json!({ "value": "Hey team" }))
    .bind("unit-test")
    .bind(Utc::now())
    .execute(&pool)
    .await
    .expect("insert fact");

    sqlx::query(
        r#"
        INSERT INTO episodic_events (subject_id, event_id, occurred_at, channel, event_type, payload)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(subject_id)
    .bind(Uuid::new_v4())
    .bind(Utc::now())
    .bind("telegram")
    .bind("message")
    .bind(json!({ "content": "Ping" }))
    .execute(&pool)
    .await
    .expect("insert episodic event");

    let embedding_id = Uuid::new_v4();
    let embedding = [0.25_f32, -0.5_f32, 0.75_f32];
    let embedding_literal = format!(
        "[{}]",
        embedding
            .iter()
            .map(|component| component.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    );

    sqlx::query(
        r#"
        INSERT INTO vector_embeddings (
            subject_id,
            embedding_id,
            embedding_model,
            embedding,
            label,
            metadata
        )
        VALUES ($1, $2, $3, $4::vector, $5, $6)
        "#,
    )
    .bind(subject_id)
    .bind(embedding_id)
    .bind("text-embedding-3-small")
    .bind(embedding_literal)
    .bind(Some("unit test chunk"))
    .bind(json!({ "source": "test", "chunk": 0 }))
    .execute(&pool)
    .await
    .expect("insert vector embedding");

    let row = sqlx::query(
        r#"
        SELECT
            embedding::float4[] AS components,
            metadata
        FROM vector_embeddings
        WHERE embedding_id = $1
        "#,
    )
    .bind(embedding_id)
    .fetch_one(&pool)
    .await
    .expect("fetch embedding");

    let stored_embedding: Vec<f32> = row.try_get("components").expect("vector components");
    assert_eq!(stored_embedding, embedding);

    let stored_metadata: serde_json::Value = row.try_get("metadata").expect("metadata");
    assert_eq!(stored_metadata["source"], "test");
}
