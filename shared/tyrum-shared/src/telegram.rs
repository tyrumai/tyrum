use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde::de::IgnoredAny;
use thiserror::Error;

use crate::{
    MediaKind, MessageContent, MessageSource, NormalizedMessage, NormalizedThread,
    NormalizedThreadMessage, PiiField, SenderMetadata, ThreadKind,
};

/// Normalize a raw Telegram update payload into the shared thread/message schema.
pub fn normalize_update(
    payload: &[u8],
) -> Result<NormalizedThreadMessage, TelegramNormalizationError> {
    let update: TelegramUpdate =
        serde_json::from_slice(payload).map_err(TelegramNormalizationError::InvalidPayload)?;
    normalize_parsed_update(update)
}

/// Normalize a pre-deserialized Telegram update.
pub fn normalize_parsed_update(
    update: TelegramUpdate,
) -> Result<NormalizedThreadMessage, TelegramNormalizationError> {
    let message = update
        .edited_message
        .or(update.message)
        .ok_or(TelegramNormalizationError::MissingMessage)?;

    let thread = to_normalized_thread(&message.chat);
    let timestamp = to_datetime(message.date)?;
    let edited_timestamp = match message.edit_date {
        Some(ts) => Some(to_datetime(ts)?),
        None => None,
    };

    let content = extract_content(&message)?;
    let mut message_pii = pii_from_content(&content);

    let sender = message.from.as_ref().map(|user| {
        if user.first_name.is_some() {
            message_pii.push(PiiField::SenderFirstName);
        }
        if user.last_name.is_some() {
            message_pii.push(PiiField::SenderLastName);
        }
        if user.username.is_some() {
            message_pii.push(PiiField::SenderUsername);
        }
        if user.language_code.is_some() {
            message_pii.push(PiiField::SenderLanguageCode);
        }

        SenderMetadata {
            id: user.id.to_string(),
            is_bot: user.is_bot,
            first_name: user.first_name.clone(),
            last_name: user.last_name.clone(),
            username: user.username.clone(),
            language_code: user.language_code.clone(),
        }
    });

    let normalized = NormalizedMessage {
        id: message.message_id.to_string(),
        thread_id: thread.id.clone(),
        source: MessageSource::Telegram,
        content,
        sender,
        timestamp,
        edited_timestamp,
        pii_fields: message_pii,
    };

    Ok(NormalizedThreadMessage {
        thread,
        message: normalized,
    })
}

/// Errors yielded when normalizing Telegram updates.
#[derive(Debug, Error)]
pub enum TelegramNormalizationError {
    #[error("failed to deserialize telegram update: {0}")]
    InvalidPayload(serde_json::Error),
    #[error("telegram update did not include a message or edited_message payload")]
    MissingMessage,
    #[error("unable to map telegram content into normalized schema")]
    UnsupportedContent,
    #[error("encountered invalid unix timestamp: {0}")]
    InvalidTimestamp(i64),
}

#[derive(Debug, Deserialize)]
pub struct TelegramUpdate {
    pub update_id: i64,
    pub message: Option<TelegramMessage>,
    pub edited_message: Option<TelegramMessage>,
}

#[derive(Debug, Deserialize)]
pub struct TelegramMessage {
    pub message_id: i64,
    pub date: i64,
    pub edit_date: Option<i64>,
    pub from: Option<TelegramUser>,
    pub chat: TelegramChat,
    pub text: Option<String>,
    pub caption: Option<String>,
    #[serde(default)]
    pub photo: Vec<IgnoredAny>,
    pub animation: Option<IgnoredAny>,
    pub audio: Option<IgnoredAny>,
    pub document: Option<IgnoredAny>,
    pub video: Option<IgnoredAny>,
    pub voice: Option<IgnoredAny>,
    pub video_note: Option<IgnoredAny>,
    pub sticker: Option<IgnoredAny>,
}

#[derive(Debug, Deserialize)]
pub struct TelegramUser {
    pub id: i64,
    #[serde(default)]
    pub is_bot: bool,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub username: Option<String>,
    pub language_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TelegramChat {
    pub id: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub title: Option<String>,
    pub username: Option<String>,
}

fn to_normalized_thread(chat: &TelegramChat) -> NormalizedThread {
    let mut pii_fields = Vec::new();
    if chat.title.is_some() {
        pii_fields.push(PiiField::ThreadTitle);
    }
    if chat.username.is_some() {
        pii_fields.push(PiiField::ThreadUsername);
    }

    NormalizedThread {
        id: chat.id.to_string(),
        kind: match chat.kind.as_str() {
            "private" => ThreadKind::Private,
            "group" => ThreadKind::Group,
            "supergroup" => ThreadKind::Supergroup,
            "channel" => ThreadKind::Channel,
            _ => ThreadKind::Other,
        },
        title: chat.title.clone(),
        username: chat.username.clone(),
        pii_fields,
    }
}

fn extract_content(
    message: &TelegramMessage,
) -> Result<MessageContent, TelegramNormalizationError> {
    if let Some(text) = &message.text {
        return Ok(MessageContent::Text { text: text.clone() });
    }

    if let Some(media_kind) = infer_media_kind(message) {
        return Ok(MessageContent::MediaPlaceholder {
            media_kind,
            caption: message.caption.clone(),
        });
    }

    if let Some(caption) = &message.caption {
        return Ok(MessageContent::MediaPlaceholder {
            media_kind: MediaKind::Unknown,
            caption: Some(caption.clone()),
        });
    }

    Err(TelegramNormalizationError::UnsupportedContent)
}

fn infer_media_kind(message: &TelegramMessage) -> Option<MediaKind> {
    if !message.photo.is_empty() {
        return Some(MediaKind::Photo);
    }
    if message.video.is_some() {
        return Some(MediaKind::Video);
    }
    if message.animation.is_some() {
        return Some(MediaKind::Animation);
    }
    if message.document.is_some() {
        return Some(MediaKind::Document);
    }
    if message.audio.is_some() {
        return Some(MediaKind::Audio);
    }
    if message.voice.is_some() {
        return Some(MediaKind::Voice);
    }
    if message.video_note.is_some() {
        return Some(MediaKind::VideoNote);
    }
    if message.sticker.is_some() {
        return Some(MediaKind::Sticker);
    }

    None
}

fn pii_from_content(content: &MessageContent) -> Vec<PiiField> {
    match content {
        MessageContent::Text { .. } => vec![PiiField::MessageText],
        MessageContent::MediaPlaceholder { caption, .. } => {
            let mut fields = Vec::new();
            if caption.is_some() {
                fields.push(PiiField::MessageCaption);
            }
            fields
        }
    }
}

fn to_datetime(timestamp: i64) -> Result<DateTime<Utc>, TelegramNormalizationError> {
    DateTime::from_timestamp(timestamp, 0)
        .ok_or(TelegramNormalizationError::InvalidTimestamp(timestamp))
}

#[cfg(test)]
mod telegram_normalization {
    use super::*;
    use chrono::{TimeZone, Utc};
    use pretty_assertions::assert_eq;

    #[test]
    fn normalizes_text_message() {
        let payload = include_bytes!("../../tests/fixtures/telegram/text_message.json");
        let update = normalize_update(payload).expect("normalize text message");

        let expected_thread = NormalizedThread {
            id: "987654321".into(),
            kind: ThreadKind::Private,
            title: None,
            username: None,
            pii_fields: Vec::new(),
        };
        assert_eq!(update.thread, expected_thread);

        let expected_message = NormalizedMessage {
            id: "111".into(),
            thread_id: "987654321".into(),
            source: MessageSource::Telegram,
            content: MessageContent::Text {
                text: "Hello planner".into(),
            },
            sender: Some(SenderMetadata {
                id: "555555".into(),
                is_bot: false,
                first_name: Some("Ron".into()),
                last_name: Some("Swanson".into()),
                username: Some("rons".into()),
                language_code: Some("en".into()),
            }),
            timestamp: Utc.timestamp_opt(1_710_000_000, 0).single().unwrap(),
            edited_timestamp: None,
            pii_fields: vec![
                PiiField::MessageText,
                PiiField::SenderFirstName,
                PiiField::SenderLastName,
                PiiField::SenderUsername,
                PiiField::SenderLanguageCode,
            ],
        };

        assert_eq!(update.message, expected_message);
    }

    #[test]
    fn normalizes_edited_message() {
        let payload = include_bytes!("../../tests/fixtures/telegram/edited_message.json");
        let update = normalize_update(payload).expect("normalize edited message");

        assert_eq!(
            update.message.edited_timestamp,
            Some(Utc.timestamp_opt(1_710_000_600, 0).single().unwrap())
        );
        assert!(matches!(
            update.message.content,
            MessageContent::Text { ref text } if text == "Hello planner edited"
        ));
        assert!(update.message.pii_fields.contains(&PiiField::MessageText));
    }

    #[test]
    fn normalizes_media_message() {
        let payload = include_bytes!("../../tests/fixtures/telegram/media_message.json");
        let update = normalize_update(payload).expect("normalize media message");

        assert_eq!(update.thread.kind, ThreadKind::Supergroup);
        assert!(update.thread.pii_fields.contains(&PiiField::ThreadTitle));

        match update.message.content {
            MessageContent::MediaPlaceholder {
                media_kind,
                caption,
            } => {
                assert_eq!(media_kind, MediaKind::Photo);
                assert_eq!(caption.as_deref(), Some("Check this out"));
            }
            other => panic!("unexpected content: {other:?}"),
        }

        assert!(
            update
                .message
                .pii_fields
                .contains(&PiiField::MessageCaption)
        );
    }

    #[test]
    fn normalizes_unknown_media_with_caption() {
        let payload = include_bytes!("../../tests/fixtures/telegram/unknown_media_caption.json");
        let update = normalize_update(payload).expect("normalize unknown media");

        match update.message.content {
            MessageContent::MediaPlaceholder {
                media_kind,
                caption,
            } => {
                assert_eq!(media_kind, MediaKind::Unknown);
                assert_eq!(caption.as_deref(), Some("Future media caption"));
            }
            other => panic!("unexpected content: {other:?}"),
        }

        assert!(
            update
                .message
                .pii_fields
                .contains(&PiiField::MessageCaption)
        );
    }

    #[test]
    fn rejects_unknown_payload() {
        let payload = br#"{"update_id": 1}"#;
        let err = normalize_update(payload).expect_err("unsupported payload");
        assert!(matches!(err, TelegramNormalizationError::MissingMessage));
    }
}
