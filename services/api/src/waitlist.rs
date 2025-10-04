use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::migrate::MigrateError;
use sqlx::{PgPool, postgres::PgPoolOptions};
use thiserror::Error;
use tracing::instrument;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// Representation of a waitlist signup as stored in the database.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct WaitlistSignup {
    pub id: i64,
    pub email: String,
    pub utm_source: Option<String>,
    pub utm_medium: Option<String>,
    pub utm_campaign: Option<String>,
    pub utm_term: Option<String>,
    pub utm_content: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Payload used when inserting a new waitlist signup.
#[derive(Debug, Clone)]
pub struct NewWaitlistSignup {
    pub email: String,
    pub utm_source: Option<String>,
    pub utm_medium: Option<String>,
    pub utm_campaign: Option<String>,
    pub utm_term: Option<String>,
    pub utm_content: Option<String>,
}

impl NewWaitlistSignup {
    pub fn new(email: String) -> Self {
        Self {
            email,
            utm_source: None,
            utm_medium: None,
            utm_campaign: None,
            utm_term: None,
            utm_content: None,
        }
    }

    pub fn with_campaign_params(
        mut self,
        utm_source: Option<String>,
        utm_medium: Option<String>,
        utm_campaign: Option<String>,
        utm_term: Option<String>,
        utm_content: Option<String>,
    ) -> Self {
        self.utm_source = utm_source;
        self.utm_medium = utm_medium;
        self.utm_campaign = utm_campaign;
        self.utm_term = utm_term;
        self.utm_content = utm_content;
        self
    }
}

/// Errors that may be returned when interacting with the waitlist repository.
#[derive(Debug, Error)]
pub enum WaitlistError {
    #[error("waitlist email already registered")]
    AlreadyRegistered,
    #[error("database error: {0}")]
    Database(sqlx::Error),
    #[error("migration error: {0}")]
    Migration(#[from] MigrateError),
}

impl From<sqlx::Error> for WaitlistError {
    fn from(error: sqlx::Error) -> Self {
        if let sqlx::Error::Database(db_err) = &error {
            if db_err.constraint() == Some("waitlist_signups_email_unique") {
                return WaitlistError::AlreadyRegistered;
            }
        }
        WaitlistError::Database(error)
    }
}

/// Data access entry point for waitlist signups.
#[derive(Clone)]
pub struct WaitlistRepository {
    pool: PgPool,
}

impl WaitlistRepository {
    pub fn from_pool(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn connect(database_url: &str) -> Result<Self, WaitlistError> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;
        Ok(Self { pool })
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    #[instrument(skip_all)]
    pub async fn migrate(&self) -> Result<(), WaitlistError> {
        MIGRATOR.run(&self.pool).await?;
        Ok(())
    }

    #[instrument(skip_all)]
    pub async fn insert(&self, signup: NewWaitlistSignup) -> Result<WaitlistSignup, WaitlistError> {
        let record = sqlx::query_as::<_, WaitlistSignup>(
            r#"
            INSERT INTO waitlist_signups
                (email, utm_source, utm_medium, utm_campaign, utm_term, utm_content)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, email, utm_source, utm_medium, utm_campaign, utm_term, utm_content, created_at
            "#,
        )
        .bind(signup.email)
        .bind(signup.utm_source)
        .bind(signup.utm_medium)
        .bind(signup.utm_campaign)
        .bind(signup.utm_term)
        .bind(signup.utm_content)
        .fetch_one(&self.pool)
        .await?;

        Ok(record)
    }
}
