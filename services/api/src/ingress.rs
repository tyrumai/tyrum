use serde_json::Value;
use sqlx::PgPool;
use thiserror::Error;
use tracing::instrument;

use tyrum_shared::{MessageSource, NormalizedMessage, NormalizedThread, PiiField, ThreadKind};

#[derive(Debug, Error)]
pub enum IngressRepositoryError {
    #[error("ingress message already exists for the given source, thread, and message identifiers")]
    MessageAlreadyExists,
    #[error("failed to serialize ingress payload: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("database error: {0}")]
    Database(sqlx::Error),
}

/// Repository that persists normalized ingress threads and messages.
#[derive(Clone)]
pub struct IngressRepository {
    pool: PgPool,
}

impl IngressRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    #[instrument(skip_all)]
    pub async fn upsert_thread(
        &self,
        source: MessageSource,
        thread: &NormalizedThread,
    ) -> Result<(), IngressRepositoryError> {
        let source_value = message_source_str(source);
        let kind_value = thread_kind_str(thread.kind);
        let pii_fields = map_pii_fields(&thread.pii_fields);

        sqlx::query(
            r#"
            INSERT INTO ingress_threads (source, thread_id, kind, title, username, pii_fields)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (source, thread_id)
            DO UPDATE
            SET kind = EXCLUDED.kind,
                title = EXCLUDED.title,
                username = EXCLUDED.username,
                pii_fields = EXCLUDED.pii_fields,
                updated_at = NOW()
            "#,
        )
        .bind(source_value)
        .bind(&thread.id)
        .bind(kind_value)
        .bind(&thread.title)
        .bind(&thread.username)
        .bind(pii_fields)
        .execute(&self.pool)
        .await
        .map(|_| ())
        .map_err(IngressRepositoryError::Database)
    }

    #[instrument(skip_all)]
    pub async fn insert_message(
        &self,
        message: &NormalizedMessage,
    ) -> Result<(), IngressRepositoryError> {
        let source_value = message_source_str(message.source);
        let content: Value = serde_json::to_value(&message.content)?;
        let sender: Option<Value> = message
            .sender
            .as_ref()
            .map(serde_json::to_value)
            .transpose()?;
        let pii_fields = map_pii_fields(&message.pii_fields);

        let result = sqlx::query(
            r#"
            INSERT INTO ingress_messages (
                source,
                thread_id,
                message_id,
                content,
                sender,
                occurred_at,
                edited_at,
                pii_fields
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
        )
        .bind(source_value)
        .bind(&message.thread_id)
        .bind(&message.id)
        .bind(content)
        .bind(sender)
        .bind(message.timestamp)
        .bind(message.edited_timestamp)
        .bind(pii_fields)
        .execute(&self.pool)
        .await;

        match result {
            Ok(_) => Ok(()),
            Err(error) => {
                if let sqlx::Error::Database(db_err) = &error
                    && db_err.constraint() == Some("ingress_messages_pk")
                {
                    return Err(IngressRepositoryError::MessageAlreadyExists);
                }
                Err(IngressRepositoryError::Database(error))
            }
        }
    }
}

fn message_source_str(source: MessageSource) -> &'static str {
    match source {
        MessageSource::Telegram => "telegram",
    }
}

fn thread_kind_str(kind: ThreadKind) -> &'static str {
    match kind {
        ThreadKind::Private => "private",
        ThreadKind::Group => "group",
        ThreadKind::Supergroup => "supergroup",
        ThreadKind::Channel => "channel",
        ThreadKind::Other => "other",
    }
}

fn map_pii_fields(fields: &[PiiField]) -> Vec<String> {
    fields
        .iter()
        .map(|field| pii_field_str(*field).to_string())
        .collect()
}

fn pii_field_str(field: PiiField) -> &'static str {
    match field {
        PiiField::MessageCaption => "message_caption",
        PiiField::MessageText => "message_text",
        PiiField::SenderFirstName => "sender_first_name",
        PiiField::SenderLastName => "sender_last_name",
        PiiField::SenderLanguageCode => "sender_language_code",
        PiiField::SenderUsername => "sender_username",
        PiiField::ThreadTitle => "thread_title",
        PiiField::ThreadUsername => "thread_username",
    }
}
