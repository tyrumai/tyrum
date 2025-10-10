use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value};
use sqlx::{FromRow, PgPool};
use thiserror::Error;
use uuid::Uuid;

pub const DEFAULT_PAM_PROFILE_ID: &str = "pam-default";
pub const DEFAULT_PVP_PROFILE_ID: &str = "pvp-default";

#[derive(Debug, Error)]
pub enum ProfilesError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

#[derive(Clone)]
pub struct ProfilesRepository {
    pool: PgPool,
}

impl ProfilesRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn fetch_profiles(
        &self,
        subject_id: Uuid,
    ) -> Result<ProfilesEnvelope, ProfilesError> {
        let pam = sqlx::query_as::<_, PamProfileRecord>(
            r#"
                SELECT profile_id, version, profile, confidence, updated_at
                FROM pam_profiles
                WHERE subject_id = $1
                ORDER BY updated_at DESC
                LIMIT 1
            "#,
        )
        .bind(subject_id)
        .fetch_optional(&self.pool)
        .await?
        .map(PamProfileResponse::from);

        let pvp = sqlx::query_as::<_, PvpProfileRecord>(
            r#"
                SELECT profile_id, version, profile, updated_at
                FROM pvp_profiles
                WHERE subject_id = $1
                ORDER BY updated_at DESC
                LIMIT 1
            "#,
        )
        .bind(subject_id)
        .fetch_optional(&self.pool)
        .await?
        .map(PvpProfileResponse::from);

        Ok(ProfilesEnvelope { pam, pvp })
    }

    pub async fn upsert_pam_profile(
        &self,
        subject_id: Uuid,
        profile_id: &str,
        profile: Value,
        confidence: Option<Value>,
    ) -> Result<PamProfileResponse, ProfilesError> {
        let version = Uuid::new_v4();
        let confidence = confidence.unwrap_or_else(|| Value::Object(JsonMap::new()));

        let record = sqlx::query_as::<_, PamProfileRecord>(
            r#"
            INSERT INTO pam_profiles (subject_id, profile_id, version, profile, confidence)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (subject_id, profile_id)
            DO UPDATE SET
                version = EXCLUDED.version,
                profile = EXCLUDED.profile,
                confidence = EXCLUDED.confidence,
                updated_at = NOW()
            RETURNING profile_id, version, profile, confidence, updated_at
            "#,
        )
        .bind(subject_id)
        .bind(profile_id)
        .bind(version)
        .bind(profile)
        .bind(confidence)
        .fetch_one(&self.pool)
        .await?;

        Ok(PamProfileResponse::from(record))
    }

    pub async fn upsert_pvp_profile(
        &self,
        subject_id: Uuid,
        profile_id: &str,
        profile: Value,
    ) -> Result<PvpProfileResponse, ProfilesError> {
        let version = Uuid::new_v4();

        let record = sqlx::query_as::<_, PvpProfileRecord>(
            r#"
            INSERT INTO pvp_profiles (subject_id, profile_id, version, profile)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (subject_id, profile_id)
            DO UPDATE SET
                version = EXCLUDED.version,
                profile = EXCLUDED.profile,
                updated_at = NOW()
            RETURNING profile_id, version, profile, updated_at
            "#,
        )
        .bind(subject_id)
        .bind(profile_id)
        .bind(version)
        .bind(profile)
        .fetch_one(&self.pool)
        .await?;

        Ok(PvpProfileResponse::from(record))
    }
}

#[derive(Debug, Serialize)]
pub struct ProfilesEnvelope {
    pub pam: Option<PamProfileResponse>,
    pub pvp: Option<PvpProfileResponse>,
}

#[derive(Debug, Serialize)]
pub struct PamProfileResponse {
    pub profile_id: String,
    pub version: String,
    pub profile: Value,
    pub confidence: Value,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct PvpProfileResponse {
    pub profile_id: String,
    pub version: String,
    pub profile: Value,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct PamProfileUpdateRequest {
    pub profile: Value,
    #[serde(default)]
    pub confidence: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct PvpProfileUpdateRequest {
    pub profile: Value,
}

#[derive(Debug, FromRow)]
struct PamProfileRecord {
    profile_id: String,
    version: Uuid,
    profile: Value,
    confidence: Value,
    updated_at: DateTime<Utc>,
}

impl From<PamProfileRecord> for PamProfileResponse {
    fn from(record: PamProfileRecord) -> Self {
        Self {
            profile_id: record.profile_id,
            version: record.version.to_string(),
            profile: record.profile,
            confidence: record.confidence,
            updated_at: record.updated_at,
        }
    }
}

#[derive(Debug, FromRow)]
struct PvpProfileRecord {
    profile_id: String,
    version: Uuid,
    profile: Value,
    updated_at: DateTime<Utc>,
}

impl From<PvpProfileRecord> for PvpProfileResponse {
    fn from(record: PvpProfileRecord) -> Self {
        Self {
            profile_id: record.profile_id,
            version: record.version.to_string(),
            profile: record.profile,
            updated_at: record.updated_at,
        }
    }
}
