use std::{sync::Arc, time::Duration};

use async_nats::{
    ConnectOptions,
    jetstream::{
        self,
        consumer::{self, AckPolicy, PullConsumer},
        stream::{Config as StreamConfig, Info as StreamInfo, Stream as JetStream},
    },
};
use futures::StreamExt;

use crate::{config::JetStreamConfig, error::JetStreamError};

type JetStreamStream = JetStream<StreamInfo>;

const DEFAULT_MAX_MESSAGES_PER_SUBJECT: i64 = 512;
const DEFAULT_STREAM_MAX_AGE_SECS: u64 = 3_600;

/// Handles JetStream connectivity and sample publish/consume flows for watchers.
#[derive(Clone)]
pub struct JetStreamClient {
    config: Arc<JetStreamConfig>,
    _client: async_nats::Client,
    context: jetstream::Context,
}

/// Minimal health snapshot for a JetStream account.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JetStreamHealth {
    /// Optional JetStream domain returned by the server.
    pub domain: Option<String>,
    /// Active stream count within the account.
    pub streams: usize,
    /// Active consumer count within the account.
    pub consumers: usize,
    /// Memory usage reported by JetStream.
    pub memory_bytes: u64,
    /// Storage usage reported by JetStream.
    pub storage_bytes: u64,
}

impl JetStreamClient {
    /// Establishes a connection using the provided configuration and ensures the watcher stream exists.
    ///
    /// # Errors
    ///
    /// Returns [`JetStreamError::Connect`] if the NATS handshake fails or
    /// [`JetStreamError::Stream`] when the watcher stream cannot be created.
    pub async fn connect(config: JetStreamConfig) -> Result<Self, JetStreamError> {
        let client = ConnectOptions::new()
            .name(config.client_name().to_string())
            .connect(config.nats_url())
            .await
            .map_err(|source| JetStreamError::Connect { source })?;

        let context = jetstream::new(client.clone());

        let instance = Self {
            context,
            _client: client,
            config: Arc::new(config),
        };

        instance.ensure_stream().await?;

        Ok(instance)
    }

    /// Queries the JetStream account and returns the reported usage statistics.
    ///
    /// # Errors
    ///
    /// Returns [`JetStreamError::Account`] when the JetStream management API cannot
    /// return account information.
    pub async fn health_check(&self) -> Result<JetStreamHealth, JetStreamError> {
        let account = self
            .context
            .query_account()
            .await
            .map_err(|source| JetStreamError::Account { source })?;

        Ok(JetStreamHealth {
            domain: account.domain.clone(),
            streams: account.streams,
            consumers: account.consumers,
            memory_bytes: account.memory,
            storage_bytes: account.storage,
        })
    }

    /// Publishes a sample payload to the watcher stream and waits for JetStream acknowledgement.
    ///
    /// # Errors
    ///
    /// Returns [`JetStreamError::Stream`] when the watcher stream cannot be created,
    /// or [`JetStreamError::Publish`] when the JetStream publish API rejects the message.
    pub async fn publish_sample_event(&self, payload: &[u8]) -> Result<(), JetStreamError> {
        self.ensure_stream().await?;

        let subject = self.config.sample_subject().to_string();

        let ack = self
            .context
            .publish(subject.clone(), payload.to_vec().into())
            .await
            .map_err(|source| JetStreamError::Publish {
                subject: subject.clone(),
                source,
            })?;

        ack.await
            .map_err(|source| JetStreamError::Publish { subject, source })?;

        Ok(())
    }

    /// Publishes a payload to an arbitrary watcher subject.
    ///
    /// # Errors
    ///
    /// Returns [`JetStreamError::Stream`] if the watcher stream cannot be created
    /// or [`JetStreamError::Publish`] when JetStream rejects or fails to acknowledge the message.
    pub async fn publish(
        &self,
        subject: impl Into<String>,
        payload: &[u8],
    ) -> Result<(), JetStreamError> {
        self.ensure_stream().await?;

        let subject = subject.into();
        let ack = self
            .context
            .publish(subject.clone(), payload.to_vec().into())
            .await
            .map_err(|source| JetStreamError::Publish {
                subject: subject.clone(),
                source,
            })?;

        ack.await
            .map_err(|source| JetStreamError::Publish { subject, source })?;

        Ok(())
    }

    /// Attempts to consume one sample event, acknowledging it back to JetStream when received.
    ///
    /// # Errors
    ///
    /// Returns [`JetStreamError::Stream`] or [`JetStreamError::Consumer`] when the
    /// infrastructure primitives cannot be provisioned, [`JetStreamError::Fetch`]
    /// when retrieving messages fails, [`JetStreamError::Message`] for stream errors,
    /// or [`JetStreamError::Ack`] if acknowledgement cannot be sent.
    pub async fn consume_sample_event(
        &self,
        timeout: Duration,
    ) -> Result<Option<Vec<u8>>, JetStreamError> {
        let consumer = self.ensure_sample_consumer().await?;
        let consumer_name = self.config.sample_consumer().to_string();

        let mut messages = consumer
            .fetch()
            .max_messages(1)
            .expires(timeout)
            .messages()
            .await
            .map_err(|source| JetStreamError::Fetch {
                consumer: consumer_name.clone(),
                source,
            })?;

        if let Some(message) = messages.next().await {
            let message = message.map_err(|source| JetStreamError::Message {
                consumer: consumer_name.clone(),
                source,
            })?;

            let payload = message.message.payload.clone().to_vec();

            message.ack().await.map_err(|source| JetStreamError::Ack {
                consumer: consumer_name,
                source,
            })?;

            Ok(Some(payload))
        } else {
            Ok(None)
        }
    }

    async fn ensure_stream(&self) -> Result<(), JetStreamError> {
        self.stream().await.map(|_| ())
    }

    async fn ensure_sample_consumer(&self) -> Result<PullConsumer, JetStreamError> {
        let consumer_name = self.config.sample_consumer().to_string();
        let subject = self.config.sample_subject().to_string();
        self.pull_consumer(consumer_name, subject).await
    }

    /// Creates or retrieves the configured pull consumer with the supplied durable name and subject filter.
    ///
    /// # Errors
    ///
    /// Returns [`JetStreamError::Stream`] when the watcher stream cannot be provisioned
    /// or [`JetStreamError::Consumer`] if the durable consumer cannot be created.
    pub async fn pull_consumer(
        &self,
        durable_name: impl Into<String>,
        filter_subject: impl Into<String>,
    ) -> Result<PullConsumer, JetStreamError> {
        let stream = self.stream().await?;
        let consumer_name = durable_name.into();
        let subject = filter_subject.into();

        stream
            .get_or_create_consumer(
                &consumer_name,
                consumer::pull::Config {
                    durable_name: Some(consumer_name.clone()),
                    filter_subject: subject,
                    ack_policy: AckPolicy::Explicit,
                    ..Default::default()
                },
            )
            .await
            .map_err(|source| JetStreamError::Consumer {
                consumer: consumer_name,
                source,
            })
    }

    /// Returns the immutable JetStream configuration backing this client.
    #[must_use]
    pub fn config(&self) -> &JetStreamConfig {
        self.config.as_ref()
    }

    async fn stream(&self) -> Result<JetStreamStream, JetStreamError> {
        let stream_name = self.config.stream_name().to_string();
        let subjects = vec![format!("{}.*", self.config.subject_prefix())];

        let mut config = StreamConfig {
            name: stream_name.clone(),
            subjects,
            ..StreamConfig::default()
        };

        if config.max_messages_per_subject == 0 {
            config.max_messages_per_subject = DEFAULT_MAX_MESSAGES_PER_SUBJECT;
        }

        if config.max_age.is_zero() {
            config.max_age = Duration::from_secs(DEFAULT_STREAM_MAX_AGE_SECS);
        }

        self.context
            .get_or_create_stream(config)
            .await
            .map_err(|source| JetStreamError::Stream {
                stream: stream_name,
                source,
            })
    }
}
