use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use thiserror::Error;
use tracing::instrument;

/// Preference toggle for a single integration within the portal linking surface.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct AccountLinkPreference {
    pub account_id: String,
    pub integration_slug: String,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Errors returned by the account linking storage layer.
#[derive(Debug, Error)]
pub enum AccountLinkingError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// Repository for reading and storing account linking preferences.
#[derive(Clone)]
pub struct AccountLinkingRepository {
    pool: PgPool,
}

impl AccountLinkingRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    #[instrument(skip_all)]
    pub async fn list_for_account(
        &self,
        account_id: &str,
    ) -> Result<Vec<AccountLinkPreference>, AccountLinkingError> {
        let preferences = sqlx::query_as::<_, AccountLinkPreference>(
            r#"
            SELECT account_id, integration_slug, enabled, created_at, updated_at
            FROM account_link_preferences
            WHERE account_id = $1
            ORDER BY integration_slug
            "#,
        )
        .bind(account_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(preferences)
    }

    #[instrument(skip_all)]
    pub async fn upsert_preference(
        &self,
        account_id: &str,
        integration_slug: &str,
        enabled: bool,
    ) -> Result<AccountLinkPreference, AccountLinkingError> {
        let preference = sqlx::query_as::<_, AccountLinkPreference>(
            r#"
            INSERT INTO account_link_preferences (account_id, integration_slug, enabled)
            VALUES ($1, $2, $3)
            ON CONFLICT (account_id, integration_slug)
            DO UPDATE
            SET enabled = EXCLUDED.enabled,
                updated_at = NOW()
            RETURNING account_id, integration_slug, enabled, created_at, updated_at
            "#,
        )
        .bind(account_id)
        .bind(integration_slug)
        .bind(enabled)
        .fetch_one(&self.pool)
        .await?;

        Ok(preference)
    }
}
