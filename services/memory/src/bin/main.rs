use chrono::Utc;
use clap::{Parser, Subcommand};
use serde_json::{Value, json};
use uuid::Uuid;

use tyrum_memory::{MemoryDal, NewEpisodicEvent, NewFact, NewVectorEmbedding};

#[derive(Debug, Parser)]
#[command(name = "tyrum-memory", about = "CLI helpers for Tyrum memory stores")]
struct Cli {
    /// Postgres connection string; falls back to DATABASE_URL.
    #[arg(long, env = "DATABASE_URL")]
    database_url: String,

    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Insert canonical sample data for manual smoke tests.
    InsertSample {
        /// Subject identifier to attribute the sample memory to; generates one if omitted.
        #[arg(long)]
        subject: Option<Uuid>,
    },
    /// Retrieve memory artifacts for the given subject.
    ShowSubject {
        /// Subject identifier to query.
        subject: Uuid,
        /// Emit JSON for scripting instead of a human summary.
        #[arg(long)]
        json: bool,
    },
}

#[tokio::main]
async fn main() {
    if let Err(err) = run().await {
        eprintln!("error: {err}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let dal = MemoryDal::connect(&cli.database_url).await?;

    match cli.command {
        Command::InsertSample { subject } => {
            let subject_id = subject.unwrap_or_else(Uuid::new_v4);
            insert_sample(&dal, subject_id).await?;
            println!("Inserted sample memory for subject {subject_id}");
        }
        Command::ShowSubject { subject, json } => {
            show_subject(&dal, subject, json).await?;
        }
    }

    Ok(())
}

async fn insert_sample(
    dal: &MemoryDal,
    subject_id: Uuid,
) -> Result<(), Box<dyn std::error::Error>> {
    let fact = dal
        .create_fact(NewFact {
            subject_id,
            fact_key: "preferred_greeting".into(),
            fact_value: json!({ "value": "Hey Tyrum" }),
            source: "tyrum-memory-cli".into(),
            observed_at: Utc::now(),
            confidence: 0.9,
        })
        .await?;

    let event_id = Uuid::new_v4();
    dal.create_episodic_event(NewEpisodicEvent {
        subject_id,
        event_id,
        occurred_at: Utc::now(),
        channel: "cli".into(),
        event_type: "sample_insert".into(),
        payload: json!({
            "message": "Seeded memory via CLI",
            "fact_id": fact.id
        }),
    })
    .await?;

    dal.create_vector_embedding(NewVectorEmbedding {
        subject_id,
        embedding_id: Uuid::new_v4(),
        embedding: vec![0.12_f32, 0.34_f32, -0.56_f32],
        embedding_model: "text-embedding-3-small".into(),
        label: Some("cli-sample".into()),
        metadata: Some(json!({ "event_id": event_id })),
    })
    .await?;

    Ok(())
}

async fn show_subject(
    dal: &MemoryDal,
    subject_id: Uuid,
    emit_json: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let facts = dal.list_facts_for_subject(subject_id).await?;
    let events = dal.list_episodic_events_for_subject(subject_id).await?;
    let vectors = dal.list_vector_embeddings_for_subject(subject_id).await?;

    if emit_json {
        let payload = json!({
            "subject_id": subject_id,
            "facts": facts,
            "episodic_events": events,
            "vector_embeddings": vectors,
        });
        println!("{}", serde_json::to_string_pretty(&payload)?);
        return Ok(());
    }

    println!("Subject {subject_id}");
    if facts.is_empty() {
        println!("  Facts: none");
    } else {
        println!("  Facts:");
        for fact in facts {
            println!(
                "    - {} = {} (confidence {:.2})",
                fact.fact_key,
                stringify_value(&fact.fact_value),
                fact.confidence
            );
        }
    }

    if events.is_empty() {
        println!("  Episodic events: none");
    } else {
        println!("  Episodic events:");
        for event in events {
            println!(
                "    - {} [{}] {}",
                event.event_id,
                event.event_type,
                stringify_value(&event.payload)
            );
        }
    }

    if vectors.is_empty() {
        println!("  Vector embeddings: none");
    } else {
        println!("  Vector embeddings:");
        for embedding in vectors {
            println!(
                "    - {} model={} label={:?}",
                embedding.embedding_id, embedding.embedding_model, embedding.label
            );
        }
    }

    Ok(())
}

fn stringify_value(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        _ => value.to_string(),
    }
}
