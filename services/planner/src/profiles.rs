use serde_json::Value;
use sqlx::{FromRow, PgPool};
use tracing::instrument;
use uuid::Uuid;

use tyrum_shared::planner::PamProfileRef;

/// Lightweight accessor for subject-level profile data stored in Postgres.
#[derive(Clone)]
pub struct ProfileStore {
    pool: PgPool,
}

impl ProfileStore {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Fetch the latest Policy/Autonomy Model profile reference for the subject.
    ///
    /// Returns [`None`] when no profile exists.
    ///
    /// # Errors
    ///
    /// Returns [`sqlx::Error`] if the lookup query fails.
    #[instrument(skip_all, fields(%subject_id, profile_id))]
    pub async fn pam_profile_ref(
        &self,
        subject_id: Uuid,
        profile_id: &str,
    ) -> Result<Option<PamProfileRef>, sqlx::Error> {
        let row = sqlx::query_as::<_, PamProfileRow>(
            r#"
                SELECT profile_id, version
                FROM pam_profiles
                WHERE subject_id = $1
                  AND profile_id = $2
                ORDER BY updated_at DESC
                LIMIT 1
            "#,
        )
        .bind(subject_id)
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(PamProfileRef::from))
    }

    /// Fetch the latest Persona & Voice profile JSON payload for the subject.
    ///
    /// # Errors
    ///
    /// Returns [`sqlx::Error`] if the lookup query fails.
    #[instrument(skip_all, fields(%subject_id, profile_id))]
    pub async fn pvp_profile(
        &self,
        subject_id: Uuid,
        profile_id: &str,
    ) -> Result<Option<Value>, sqlx::Error> {
        let row = sqlx::query_as::<_, PvpProfileRow>(
            r#"
                SELECT profile
                FROM pvp_profiles
                WHERE subject_id = $1
                  AND profile_id = $2
                ORDER BY updated_at DESC
                LIMIT 1
            "#,
        )
        .bind(subject_id)
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|record| record.profile))
    }
}

#[derive(Debug, FromRow)]
struct PamProfileRow {
    profile_id: String,
    version: Uuid,
}

impl From<PamProfileRow> for PamProfileRef {
    fn from(row: PamProfileRow) -> Self {
        Self {
            profile_id: row.profile_id,
            version: Some(row.version.to_string()),
        }
    }
}

#[derive(Debug, FromRow)]
struct PvpProfileRow {
    profile: Value,
}
