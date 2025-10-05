use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Source channel for a normalized message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageSource {
    Telegram,
}

/// Normalized representation of chat threads across ingress surfaces.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedThread {
    pub id: String,
    pub kind: ThreadKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    /// Enumerates thread fields that hold PII for downstream redaction pipelines.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pii_fields: Vec<PiiField>,
}

/// Canonical chat message payload consumed by planner services.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedMessage {
    pub id: String,
    pub thread_id: String,
    pub source: MessageSource,
    pub content: MessageContent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender: Option<SenderMetadata>,
    pub timestamp: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edited_timestamp: Option<DateTime<Utc>>,
    /// Enumerates message fields that hold PII for downstream redaction pipelines.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pii_fields: Vec<PiiField>,
}

/// Bundles thread + message output for ingress-specific transforms.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedThreadMessage {
    pub thread: NormalizedThread,
    pub message: NormalizedMessage,
}

/// Minimal sender metadata required for planner attribution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SenderMetadata {
    pub id: String,
    pub is_bot: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language_code: Option<String>,
}

/// Supported thread classifications surfaced by Telegram.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThreadKind {
    Private,
    Group,
    Supergroup,
    Channel,
    Other,
}

/// Ingress message content captured in the shared schema.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum MessageContent {
    Text {
        text: String,
    },
    MediaPlaceholder {
        media_kind: MediaKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        caption: Option<String>,
    },
}

/// Supported high-level media categories for placeholder normalization.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    Animation,
    Audio,
    Document,
    Photo,
    Sticker,
    Video,
    VideoNote,
    Voice,
    Unknown,
}

/// Identifies fields that may contain personal data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PiiField {
    MessageCaption,
    MessageText,
    SenderFirstName,
    SenderLastName,
    SenderLanguageCode,
    SenderUsername,
    ThreadTitle,
    ThreadUsername,
}
