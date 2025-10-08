use std::env;

use crate::error::JetStreamError;

/// Environment variable defining the JetStream server URL.
pub const URL_ENV: &str = "WATCHERS_JETSTREAM_URL";
/// Environment variable overriding the JetStream stream name.
pub const STREAM_ENV: &str = "WATCHERS_JETSTREAM_STREAM";
/// Environment variable overriding the subject prefix for watcher events.
pub const SUBJECT_PREFIX_ENV: &str = "WATCHERS_JETSTREAM_SUBJECT_PREFIX";
/// Environment variable overriding the durable consumer used by sample logic.
pub const SAMPLE_CONSUMER_ENV: &str = "WATCHERS_JETSTREAM_SAMPLE_CONSUMER";
/// Environment variable overriding the durable consumer used by the watcher processor.
pub const PROCESSOR_CONSUMER_ENV: &str = "WATCHERS_JETSTREAM_PROCESSOR_CONSUMER";
/// Environment variable overriding the client name reported to NATS.
pub const CLIENT_NAME_ENV: &str = "WATCHERS_JETSTREAM_CLIENT_NAME";

const DEFAULT_STREAM_NAME: &str = "watchers_events";
const DEFAULT_SUBJECT_PREFIX: &str = "watchers.events";
const DEFAULT_SAMPLE_CONSUMER: &str = "watchers_sample_consumer";
const DEFAULT_PROCESSOR_CONSUMER: &str = "watchers_processor";
const DEFAULT_CLIENT_NAME: &str = "tyrum-watchers";

/// Runtime configuration required to connect to JetStream.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JetStreamConfig {
    pub(crate) nats_url: String,
    pub(crate) stream_name: String,
    pub(crate) subject_prefix: String,
    pub(crate) sample_subject: String,
    pub(crate) sample_consumer: String,
    pub(crate) processor_consumer: String,
    pub(crate) client_name: String,
}

impl JetStreamConfig {
    /// Builds a configuration instance from explicit values.
    ///
    /// # Errors
    ///
    /// Returns [`JetStreamError::InvalidStreamName`] or
    /// [`JetStreamError::InvalidSubjectPrefix`] when validation fails.
    pub fn new(
        nats_url: impl Into<String>,
        stream_name: impl Into<String>,
        subject_prefix: impl Into<String>,
        sample_consumer: impl Into<String>,
        processor_consumer: impl Into<String>,
        client_name: impl Into<String>,
    ) -> Result<Self, JetStreamError> {
        let nats_url = nats_url.into();
        let stream_name = stream_name.into();
        validate_stream_name(&stream_name)?;

        let subject_prefix = subject_prefix.into();
        validate_subject_prefix(&subject_prefix)?;

        let sample_consumer = sample_consumer.into();
        validate_consumer_name(&sample_consumer)?;

        let processor_consumer = processor_consumer.into();
        validate_consumer_name(&processor_consumer)?;

        let client_name = client_name.into();
        let sample_subject = format!("{subject_prefix}.sample");

        Ok(Self {
            nats_url,
            stream_name,
            subject_prefix,
            sample_subject,
            sample_consumer,
            processor_consumer,
            client_name,
        })
    }

    /// Builds a configuration instance by reading the documented environment variables.
    ///
    /// # Errors
    ///
    /// Returns [`JetStreamError::MissingEnv`] when the mandatory server URL is absent,
    /// [`JetStreamError::InvalidStreamName`] when the provided stream name fails basic
    /// validation, or [`JetStreamError::InvalidSubjectPrefix`] when the subject prefix
    /// is empty or contains whitespace.
    pub fn from_env() -> Result<Self, JetStreamError> {
        let nats_url =
            env::var(URL_ENV).map_err(|_| JetStreamError::MissingEnv { key: URL_ENV })?;

        let stream_name = env::var(STREAM_ENV).unwrap_or_else(|_| DEFAULT_STREAM_NAME.to_string());
        validate_stream_name(&stream_name)?;

        let subject_prefix =
            env::var(SUBJECT_PREFIX_ENV).unwrap_or_else(|_| DEFAULT_SUBJECT_PREFIX.to_string());
        validate_subject_prefix(&subject_prefix)?;

        let sample_consumer =
            env::var(SAMPLE_CONSUMER_ENV).unwrap_or_else(|_| DEFAULT_SAMPLE_CONSUMER.to_string());
        validate_consumer_name(&sample_consumer)?;

        let processor_consumer = env::var(PROCESSOR_CONSUMER_ENV)
            .unwrap_or_else(|_| DEFAULT_PROCESSOR_CONSUMER.to_string());
        validate_consumer_name(&processor_consumer)?;

        let client_name =
            env::var(CLIENT_NAME_ENV).unwrap_or_else(|_| DEFAULT_CLIENT_NAME.to_string());

        Self::new(
            nats_url,
            stream_name,
            subject_prefix,
            sample_consumer,
            processor_consumer,
            client_name,
        )
    }

    /// Returns the NATS connection URL.
    #[must_use]
    pub fn nats_url(&self) -> &str {
        &self.nats_url
    }

    /// Returns the configured JetStream stream name.
    #[must_use]
    pub fn stream_name(&self) -> &str {
        &self.stream_name
    }

    /// Returns the subject prefix used for watcher events.
    #[must_use]
    pub fn subject_prefix(&self) -> &str {
        &self.subject_prefix
    }

    /// Returns the subject used by the sample publish/consume logic.
    #[must_use]
    pub fn sample_subject(&self) -> &str {
        &self.sample_subject
    }

    /// Returns the durable consumer name used by the sample logic.
    #[must_use]
    pub fn sample_consumer(&self) -> &str {
        &self.sample_consumer
    }

    /// Returns the durable consumer name used by the watcher processor.
    #[must_use]
    pub fn processor_consumer(&self) -> &str {
        &self.processor_consumer
    }

    /// Returns the NATS client name that will be announced to the server.
    #[must_use]
    pub fn client_name(&self) -> &str {
        &self.client_name
    }
}

fn validate_stream_name(value: &str) -> Result<(), JetStreamError> {
    if value.trim().is_empty() {
        return Err(JetStreamError::InvalidStreamName {
            stream: value.to_string(),
            reason: "value must not be empty",
        });
    }

    if value
        .chars()
        .any(|ch| !(ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.')))
    {
        return Err(JetStreamError::InvalidStreamName {
            stream: value.to_string(),
            reason: "only alphanumeric, hyphen, underscore, or dot characters are allowed",
        });
    }

    Ok(())
}

fn validate_subject_prefix(value: &str) -> Result<(), JetStreamError> {
    if value.trim().is_empty() {
        return Err(JetStreamError::InvalidSubjectPrefix {
            subject: value.to_string(),
            reason: "value must not be empty",
        });
    }

    if value.chars().any(char::is_whitespace) {
        return Err(JetStreamError::InvalidSubjectPrefix {
            subject: value.to_string(),
            reason: "whitespace is not allowed in NATS subjects",
        });
    }

    Ok(())
}

fn validate_consumer_name(value: &str) -> Result<(), JetStreamError> {
    if value.trim().is_empty() {
        return Err(JetStreamError::InvalidConsumerName {
            consumer: value.to_string(),
            reason: "value must not be empty",
        });
    }

    if value
        .chars()
        .any(|ch| !(ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_')))
    {
        return Err(JetStreamError::InvalidConsumerName {
            consumer: value.to_string(),
            reason: "only alphanumeric, hyphen, or underscore characters are allowed",
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consumer_name_accepts_valid_characters() {
        assert!(validate_consumer_name("Durable_Consumer-01").is_ok());
    }

    #[test]
    fn consumer_name_rejects_empty_value() {
        let err = match validate_consumer_name("") {
            Err(err) => err,
            Ok(_) => panic!("expected invalid consumer name error"),
        };
        assert!(matches!(
            err,
            JetStreamError::InvalidConsumerName { reason, .. } if reason.contains("not be empty")
        ));
    }

    #[test]
    fn consumer_name_rejects_invalid_characters() {
        let err = match validate_consumer_name("contains.dot") {
            Err(err) => err,
            Ok(_) => panic!("expected invalid consumer name error"),
        };
        assert!(matches!(
            err,
            JetStreamError::InvalidConsumerName { reason, .. } if reason.contains("alphanumeric")
        ));
    }
}
