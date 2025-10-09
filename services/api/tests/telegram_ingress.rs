#![allow(clippy::expect_used, clippy::unwrap_used)]

use chrono::{DateTime, Duration, TimeZone, Utc};
use serde_json::Value;
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use std::path::Path;
use testcontainers::{
    ContainerAsync, GenericImage, ImageExt,
    core::{IntoContainerPort, WaitFor},
    runners::AsyncRunner,
};
use tokio::time::sleep;
use tyrum_api::ingress::{IngressRepository, IngressRepositoryError};
use tyrum_shared::{
    MediaKind, MessageContent, MessageSource, NormalizedMessage, NormalizedThread, PiiField,
    SenderMetadata, ThreadKind,
};

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

struct TestContext {
    #[allow(dead_code)]
    container: ContainerAsync<GenericImage>,
    repository: IngressRepository,
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
        run_migrations(&pool).await;
        let repository = IngressRepository::new(pool);

        Self {
            container,
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

async fn run_migrations(pool: &PgPool) {
    static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");
    MIGRATOR.run(pool).await.expect("run migrations");
}

fn sample_thread() -> NormalizedThread {
    NormalizedThread {
        id: "chat-123".into(),
        kind: ThreadKind::Supergroup,
        title: Some("Virtunet Operators".into()),
        username: Some("virtunet_ops".into()),
        pii_fields: vec![PiiField::ThreadTitle, PiiField::ThreadUsername],
    }
}

fn sample_message() -> NormalizedMessage {
    NormalizedMessage {
        id: "42".into(),
        thread_id: "chat-123".into(),
        source: MessageSource::Telegram,
        content: MessageContent::MediaPlaceholder {
            media_kind: MediaKind::Photo,
            caption: Some("Receipt".into()),
        },
        sender: Some(SenderMetadata {
            id: "user-9".into(),
            is_bot: false,
            first_name: Some("Ron".into()),
            last_name: Some("Hernaus".into()),
            username: Some("ronnie".into()),
            language_code: Some("en".into()),
        }),
        timestamp: Utc.with_ymd_and_hms(2025, 10, 1, 10, 0, 0).unwrap(),
        edited_timestamp: Some(
            Utc.with_ymd_and_hms(2025, 10, 1, 10, 5, 0)
                .unwrap()
                .checked_add_signed(Duration::seconds(30))
                .unwrap(),
        ),
        pii_fields: vec![
            PiiField::MessageCaption,
            PiiField::SenderFirstName,
            PiiField::SenderLastName,
            PiiField::SenderUsername,
        ],
    }
}

#[tokio::test]
async fn upsert_thread_persists_and_updates_records() {
    if !docker_available() {
        eprintln!("skipping upsert_thread_persists_and_updates_records: docker unavailable");
        return;
    }
    let ctx = TestContext::new().await;
    let thread = sample_thread();

    ctx.repository
        .upsert_thread(MessageSource::Telegram, &thread)
        .await
        .expect("insert thread");

    let record = sqlx::query(
        r#"
        SELECT kind, title, username, pii_fields, created_at, updated_at
        FROM ingress_threads
        WHERE source = $1 AND thread_id = $2
        "#,
    )
    .bind("telegram")
    .bind(&thread.id)
    .fetch_one(ctx.repository.pool())
    .await
    .expect("fetch thread row");

    assert_eq!(record.try_get::<String, _>("kind").unwrap(), "supergroup");
    assert_eq!(
        record.try_get::<Option<String>, _>("title").unwrap(),
        thread.title
    );
    assert_eq!(
        record.try_get::<Option<String>, _>("username").unwrap(),
        thread.username
    );

    let pii: Vec<String> = record.try_get::<Vec<String>, _>("pii_fields").unwrap();
    assert_eq!(pii, vec!["thread_title", "thread_username"]);

    let created_at: DateTime<Utc> = record.try_get("created_at").unwrap();
    let original_updated_at: DateTime<Utc> = record.try_get("updated_at").unwrap();
    assert_eq!(created_at, original_updated_at);

    let mut updated_thread = thread.clone();
    updated_thread.title = Some("Virtunet Ops".into());

    ctx.repository
        .upsert_thread(MessageSource::Telegram, &updated_thread)
        .await
        .expect("update thread");

    let updated_row = sqlx::query(
        r#"
        SELECT title, updated_at
        FROM ingress_threads
        WHERE source = $1 AND thread_id = $2
        "#,
    )
    .bind("telegram")
    .bind(&updated_thread.id)
    .fetch_one(ctx.repository.pool())
    .await
    .expect("fetch updated thread");

    assert_eq!(
        updated_row.try_get::<Option<String>, _>("title").unwrap(),
        updated_thread.title
    );
    let refreshed_updated_at: DateTime<Utc> = updated_row.try_get("updated_at").unwrap();
    assert!(refreshed_updated_at >= original_updated_at);
}

#[tokio::test]
async fn insert_message_persists_and_dedupes() {
    if !docker_available() {
        eprintln!("skipping insert_message_persists_and_dedupes: docker unavailable");
        return;
    }
    let ctx = TestContext::new().await;
    let thread = sample_thread();
    ctx.repository
        .upsert_thread(MessageSource::Telegram, &thread)
        .await
        .expect("seed thread");

    let message = sample_message();
    ctx.repository
        .insert_message(&message)
        .await
        .expect("insert message");

    let row = sqlx::query(
        r#"
        SELECT thread_id, message_id, content, sender, occurred_at, edited_at, pii_fields
        FROM ingress_messages
        WHERE source = $1 AND thread_id = $2 AND message_id = $3
        "#,
    )
    .bind("telegram")
    .bind(&message.thread_id)
    .bind(&message.id)
    .fetch_one(ctx.repository.pool())
    .await
    .expect("fetch message");

    assert_eq!(
        row.try_get::<String, _>("thread_id").unwrap(),
        message.thread_id
    );
    assert_eq!(row.try_get::<String, _>("message_id").unwrap(), message.id);

    let content: Value = row.try_get("content").unwrap();
    assert_eq!(content["kind"], "media_placeholder");
    assert_eq!(content["media_kind"], "photo");
    assert_eq!(content["caption"], "Receipt");

    let sender: Option<Value> = row.try_get("sender").unwrap();
    let sender = sender.expect("sender json");
    assert_eq!(sender["id"], "user-9");
    assert_eq!(sender["first_name"], "Ron");

    assert_eq!(
        row.try_get::<DateTime<Utc>, _>("occurred_at").unwrap(),
        message.timestamp
    );
    assert_eq!(
        row.try_get::<Option<DateTime<Utc>>, _>("edited_at")
            .unwrap(),
        message.edited_timestamp
    );

    let pii: Vec<String> = row.try_get("pii_fields").unwrap();
    assert_eq!(
        pii,
        vec![
            "message_caption",
            "sender_first_name",
            "sender_last_name",
            "sender_username"
        ]
    );

    let duplicate = ctx.repository.insert_message(&message).await;
    let err = duplicate.expect_err("duplicate message should error");
    assert!(matches!(err, IngressRepositoryError::MessageAlreadyExists));
}
