#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::{path::Path, time::Duration};

use chrono::Utc;
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use testcontainers::{
    ContainerAsync, GenericImage, ImageExt,
    core::{IntoContainerPort, WaitFor},
    runners::AsyncRunner,
};
use tyrum_memory::{
    CapabilityMemoryChanges, EpisodicEventChanges, MemoryDal, MemoryError, NewCapabilityMemory,
    NewEpisodicEvent, NewFact, NewVectorEmbedding, PamProfileUpsert, PvpProfileUpsert,
    VectorEmbeddingChanges,
};
use uuid::Uuid;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

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
    dal: MemoryDal,
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

        let pool = connect_with_retry(&database_url)
            .await
            .expect("connect postgres");

        MIGRATOR.run(&pool).await.expect("run migrations");

        let dal = MemoryDal::new(pool);

        Self { container, dal }
    }
}

#[tokio::test]
async fn fact_crud_roundtrip() {
    if !docker_available() {
        eprintln!("skipping fact_crud_roundtrip: docker unavailable");
        return;
    }
    let ctx = TestContext::new().await;
    let subject_id = Uuid::new_v4();

    let created = ctx
        .dal
        .create_fact(NewFact {
            subject_id,
            fact_key: "time_zone".into(),
            fact_value: json!({ "value": "Europe/Amsterdam" }),
            source: "unit-test".into(),
            observed_at: Utc::now(),
            confidence: 0.8,
        })
        .await
        .expect("create fact");

    let fetched = ctx
        .dal
        .get_fact(created.id)
        .await
        .expect("fetch fact")
        .expect("fact present");
    assert_eq!(fetched.fact_key, "time_zone");

    let updated = ctx
        .dal
        .update_fact(
            created.id,
            tyrum_memory::FactChanges {
                fact_value: json!({ "value": "Europe/Rotterdam" }),
                source: "follow-up".into(),
                observed_at: Utc::now(),
                confidence: 0.9,
            },
        )
        .await
        .expect("update fact");
    assert_eq!(updated.source, "follow-up");
    assert_eq!(updated.confidence, 0.9);

    ctx.dal.delete_fact(created.id).await.expect("delete fact");

    let missing = ctx.dal.get_fact(created.id).await.expect("fetch deleted");
    assert!(missing.is_none());

    let err = ctx.dal.delete_fact(created.id).await.unwrap_err();
    assert!(matches!(err, MemoryError::NotFound { .. }));
}

#[tokio::test]
async fn episodic_event_crud_roundtrip() {
    if !docker_available() {
        eprintln!("skipping episodic_event_crud_roundtrip: docker unavailable");
        return;
    }
    let ctx = TestContext::new().await;
    let subject_id = Uuid::new_v4();
    let event_id = Uuid::new_v4();

    let created = ctx
        .dal
        .create_episodic_event(NewEpisodicEvent {
            subject_id,
            event_id,
            occurred_at: Utc::now(),
            channel: "telegram".into(),
            event_type: "message".into(),
            payload: json!({ "text": "Ping" }),
        })
        .await
        .expect("create event");
    assert_eq!(created.event_id, event_id);

    let fetched = ctx
        .dal
        .get_episodic_event(event_id)
        .await
        .expect("fetch event")
        .expect("event present");
    assert_eq!(fetched.channel, "telegram");

    let updated = ctx
        .dal
        .update_episodic_event(
            event_id,
            EpisodicEventChanges {
                occurred_at: Utc::now(),
                channel: "cli".into(),
                event_type: "update".into(),
                payload: json!({ "status": "ack" }),
            },
        )
        .await
        .expect("update event");
    assert_eq!(updated.channel, "cli");
    assert_eq!(updated.event_type, "update");

    ctx.dal
        .delete_episodic_event(event_id)
        .await
        .expect("delete event");

    let err = ctx.dal.delete_episodic_event(event_id).await.unwrap_err();
    assert!(matches!(err, MemoryError::NotFound { .. }));
}

#[tokio::test]
async fn capability_memory_crud_roundtrip() {
    if !docker_available() {
        eprintln!("skipping capability_memory_crud_roundtrip: docker unavailable");
        return;
    }
    let ctx = TestContext::new().await;
    let subject_id = Uuid::new_v4();

    let created = ctx
        .dal
        .create_capability_memory(NewCapabilityMemory {
            subject_id,
            capability_type: "web".into(),
            capability_identifier: "example.com.checkout".into(),
            executor_kind: "executor_web".into(),
            selectors: Some(json!({ "login_button": "#login" })),
            outcome_metadata: json!({
                "postconditions": ["order confirmation"],
                "cost_eur": 29.95
            }),
            cost_profile: json!({
                "currency": "EUR",
                "amount_minor_units": 2995,
                "observed_at": Utc::now()
            }),
            anti_bot_notes: json!([
                { "note": "Nightly maintenance window introduces 429s" }
            ]),
            result_summary: Some("Initial success".into()),
            success_count: 1,
            last_success_at: Utc::now(),
        })
        .await
        .expect("create capability memory");
    assert_eq!(created.capability_type, "web");
    assert_eq!(created.cost_profile["currency"], "EUR");
    assert_eq!(created.cost_profile["amount_minor_units"], 2995);
    assert!(
        created
            .anti_bot_notes
            .as_array()
            .map(|entries| !entries.is_empty())
            .unwrap_or(false),
        "anti-bot notes should persist"
    );

    let fetched = ctx
        .dal
        .get_capability_memory(created.id)
        .await
        .expect("fetch capability memory")
        .expect("memory present");
    assert_eq!(fetched.capability_identifier, "example.com.checkout");

    let lookup = ctx
        .dal
        .get_capability_memory_for_flow(subject_id, "web", "example.com.checkout", "executor_web")
        .await
        .expect("lookup capability memory")
        .expect("flow present");
    assert_eq!(lookup.id, created.id);

    let listed_all = ctx
        .dal
        .list_capability_memories_for_subject(subject_id)
        .await
        .expect("list capability memories");
    assert_eq!(listed_all.len(), 1);

    let listed_type = ctx
        .dal
        .list_capability_memories_for_subject_and_type(subject_id, "web")
        .await
        .expect("list capability memories by type");
    assert_eq!(listed_type.len(), 1);

    let updated = ctx
        .dal
        .update_capability_memory(
            created.id,
            CapabilityMemoryChanges {
                selectors: Some(json!({ "checkout_button": ".checkout" })),
                outcome_metadata: json!({
                    "postconditions": ["order confirmation", "receipt artifact"],
                    "cost_eur": 24.99
                }),
                cost_profile: json!({
                    "currency": "EUR",
                    "amount_minor_units": 2499,
                    "observed_at": Utc::now()
                }),
                anti_bot_notes: json!([
                    {
                        "note": "Site now prompts for security question every Monday",
                        "mitigation": "Pre-fill answer before step 2"
                    }
                ]),
                result_summary: Some("Updated flow with cached selectors".into()),
                success_count: 3,
                last_success_at: Utc::now(),
            },
        )
        .await
        .expect("update capability memory");
    assert_eq!(updated.success_count, 3);
    assert_eq!(
        updated.result_summary.as_deref(),
        Some("Updated flow with cached selectors")
    );
    assert_eq!(updated.cost_profile["amount_minor_units"], 2499);
    assert_eq!(
        updated
            .anti_bot_notes
            .as_array()
            .and_then(|array| array.first())
            .and_then(|entry| entry.get("mitigation"))
            .and_then(Value::as_str),
        Some("Pre-fill answer before step 2")
    );

    ctx.dal
        .delete_capability_memory(created.id)
        .await
        .expect("delete capability memory");

    let missing = ctx
        .dal
        .get_capability_memory(created.id)
        .await
        .expect("fetch deleted capability memory");
    assert!(missing.is_none());

    let err = ctx
        .dal
        .delete_capability_memory(created.id)
        .await
        .unwrap_err();
    assert!(matches!(err, MemoryError::NotFound { .. }));
}

#[tokio::test]
async fn pam_profile_upsert_roundtrip() {
    if !docker_available() {
        eprintln!("skipping pam_profile_upsert_roundtrip: docker unavailable");
        return;
    }

    let ctx = TestContext::new().await;
    let subject_id = Uuid::new_v4();

    let first = ctx
        .dal
        .upsert_pam_profile(PamProfileUpsert {
            subject_id,
            profile_id: "pam-default".into(),
            profile: json!({
                "escalation_mode": "ask_first",
                "auto_approve": {
                    "limit_minor_units": 1500,
                    "currency": "EUR"
                }
            }),
            confidence: Some(json!({
                "escalation_mode": 0.9,
                "auto_approve.limit_minor_units": 0.8
            })),
            version: None,
        })
        .await
        .expect("create pam profile");

    assert_eq!(
        first.profile["escalation_mode"],
        Value::String("ask_first".into())
    );

    let second = ctx
        .dal
        .upsert_pam_profile(PamProfileUpsert {
            subject_id,
            profile_id: "pam-default".into(),
            profile: json!({
                "escalation_mode": "act_within_limits",
                "auto_approve": {
                    "limit_minor_units": 2000,
                    "currency": "EUR"
                }
            }),
            confidence: None,
            version: None,
        })
        .await
        .expect("update pam profile");

    assert_ne!(first.version, second.version);
    assert_eq!(
        second.profile["escalation_mode"],
        Value::String("act_within_limits".into())
    );
    assert!(
        second
            .confidence
            .as_object()
            .map(|map| map.is_empty())
            .unwrap_or(false),
        "confidence should default to an empty object"
    );

    let fetched = ctx
        .dal
        .get_pam_profile(subject_id, "pam-default")
        .await
        .expect("fetch pam profile")
        .expect("pam profile present");

    assert_eq!(fetched.version, second.version);
    assert_eq!(fetched.profile, second.profile);
}

#[tokio::test]
async fn pvp_profile_upsert_roundtrip() {
    if !docker_available() {
        eprintln!("skipping pvp_profile_upsert_roundtrip: docker unavailable");
        return;
    }

    let ctx = TestContext::new().await;
    let subject_id = Uuid::new_v4();

    let created = ctx
        .dal
        .upsert_pvp_profile(PvpProfileUpsert {
            subject_id,
            profile_id: "pvp-default".into(),
            profile: json!({
                "tone": "calm",
                "verbosity": "balanced",
                "voice": {
                    "voice_id": "voice_a",
                    "pace": 0.5
                }
            }),
            version: None,
        })
        .await
        .expect("create pvp profile");

    assert_eq!(created.profile["tone"], Value::String("calm".into()));

    let updated = ctx
        .dal
        .upsert_pvp_profile(PvpProfileUpsert {
            subject_id,
            profile_id: "pvp-default".into(),
            profile: json!({
                "tone": "energetic",
                "verbosity": "thorough",
                "voice": {
                    "voice_id": "voice_b",
                    "pace": 0.7,
                    "warmth": 0.6
                }
            }),
            version: None,
        })
        .await
        .expect("update pvp profile");

    assert_ne!(created.version, updated.version);
    assert_eq!(
        updated.profile["voice"]["voice_id"],
        Value::String("voice_b".into())
    );

    let fetched = ctx
        .dal
        .get_pvp_profile(subject_id, "pvp-default")
        .await
        .expect("fetch pvp profile")
        .expect("pvp profile present");

    assert_eq!(fetched.version, updated.version);
    assert_eq!(fetched.profile, updated.profile);
}

#[tokio::test]
async fn vector_embedding_crud_roundtrip() {
    if !docker_available() {
        eprintln!("skipping vector_embedding_crud_roundtrip: docker unavailable");
        return;
    }
    let ctx = TestContext::new().await;
    let subject_id = Uuid::new_v4();
    let embedding_id = Uuid::new_v4();

    let created = ctx
        .dal
        .create_vector_embedding(NewVectorEmbedding {
            subject_id,
            embedding_id,
            embedding: vec![0.1, 0.2, -0.3],
            embedding_model: "text-embedding-3-small".into(),
            label: Some("initial".into()),
            metadata: Some(json!({ "chunk": 0 })),
        })
        .await
        .expect("create vector");
    assert_eq!(created.embedding, vec![0.1, 0.2, -0.3]);

    let listed = ctx
        .dal
        .list_vector_embeddings_for_subject(subject_id)
        .await
        .expect("list vectors");
    assert_eq!(listed.len(), 1);

    let updated = ctx
        .dal
        .update_vector_embedding(
            embedding_id,
            VectorEmbeddingChanges {
                embedding: vec![0.4, 0.5, 0.6],
                embedding_model: "text-embedding-3-large".into(),
                label: None,
                metadata: None,
            },
        )
        .await
        .expect("update vector");
    assert_eq!(updated.embedding_model, "text-embedding-3-large");
    assert_eq!(updated.embedding, vec![0.4, 0.5, 0.6]);

    ctx.dal
        .delete_vector_embedding(embedding_id)
        .await
        .expect("delete vector");

    let err = ctx
        .dal
        .delete_vector_embedding(embedding_id)
        .await
        .unwrap_err();
    assert!(matches!(err, MemoryError::NotFound { .. }));
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
