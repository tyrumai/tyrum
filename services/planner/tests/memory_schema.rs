use std::time::Duration;

use chrono::Utc;
use serde_json::json;
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use testcontainers::{
    ContainerAsync, GenericImage, ImageExt,
    core::{IntoContainerPort, WaitFor},
    runners::AsyncRunner,
};
use uuid::Uuid;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

const POSTGRES_IMAGE: &str = "pgvector/pgvector";
const POSTGRES_TAG: &str = "pg16";
const POSTGRES_USER: &str = "tyrum";
const POSTGRES_PASSWORD: &str = "tyrum_dev_password";
const POSTGRES_DB: &str = "tyrum_dev";

#[tokio::test(flavor = "current_thread")]
async fn pgvector_extension_supports_embedding_roundtrip() {
    let (container, pool) = setup().await;
    let _container = container;

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

async fn setup() -> (ContainerAsync<GenericImage>, PgPool) {
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

    let pool = connect_with_retry(&database_url)
        .await
        .expect("connect postgres");

    MIGRATOR.run(&pool).await.expect("run migrations");

    (container, pool)
}

async fn connect_with_retry(database_url: &str) -> Result<PgPool, sqlx::Error> {
    let mut attempts = 0;
    let max_attempts = 10;

    loop {
        match PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(5))
            .connect(database_url)
            .await
        {
            Ok(pool) => break Ok(pool),
            Err(err) if attempts < max_attempts => {
                attempts += 1;
                tokio::time::sleep(Duration::from_millis(200)).await;
                tracing::warn!(
                    attempts,
                    "waiting for postgres to accept connections: {err}"
                );
            }
            Err(err) => break Err(err),
        }
    }
}
