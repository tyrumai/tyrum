use std::{future::Future, sync::Arc, time::Duration};

use async_nats::jetstream::Message as JetStreamMessage;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::{pin, sync::mpsc::UnboundedSender, time::sleep};
use tracing::{info, warn};

use crate::{
    config::JetStreamConfig,
    error::{JetStreamError, PlannerClientError, WatcherProcessorError},
    jetstream::JetStreamClient,
};
use tyrum_shared::{PlanRequest, PlanResponse};

const DEFAULT_FETCH_TIMEOUT: Duration = Duration::from_millis(500);
const DEFAULT_IDLE_BACKOFF: Duration = Duration::from_millis(250);
const DEFAULT_MAX_BATCH: usize = 10;

/// Payload dispatched by watcher producers to trigger planner execution.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct WatcherEvent {
    /// Stable identifier for the watcher event used for dedupe and logging.
    pub event_id: String,
    /// Identifier referencing the stored watcher definition.
    pub watcher_id: i64,
    /// Plan reference associated with the watcher registration.
    pub plan_reference: String,
    /// Planner request envelope to execute.
    pub plan_request: PlanRequest,
    /// Arbitrary metadata emitted by the producer.
    #[serde(default)]
    pub metadata: Value,
}

/// Lightweight record containing the event and planner outcome.
#[derive(Clone, Debug)]
pub struct RecordedWatcherOutcome {
    /// Event processed by the watcher worker.
    pub event: WatcherEvent,
    /// Planner response returned for the event.
    pub response: PlanResponse,
}

/// Configuration options shaping watcher processor behaviour.
#[derive(Clone, Debug)]
pub struct WatcherProcessorConfig {
    consumer_name: String,
    filter_subject: String,
    fetch_timeout: Duration,
    max_batch: usize,
    idle_backoff: Duration,
}

impl WatcherProcessorConfig {
    /// Builds a configuration scoped to the supplied JetStream settings using repository defaults.
    #[must_use]
    pub fn from_jetstream(config: &JetStreamConfig) -> Self {
        Self {
            consumer_name: config.processor_consumer().to_string(),
            filter_subject: format!("{}.*", config.subject_prefix()),
            fetch_timeout: DEFAULT_FETCH_TIMEOUT,
            max_batch: DEFAULT_MAX_BATCH,
            idle_backoff: DEFAULT_IDLE_BACKOFF,
        }
    }

    /// Overrides the fetch timeout used when pulling JetStream batches.
    #[must_use]
    pub fn with_fetch_timeout(mut self, timeout: Duration) -> Self {
        self.fetch_timeout = timeout;
        self
    }

    /// Overrides the maximum number of messages fetched per batch.
    #[must_use]
    pub fn with_max_batch(mut self, max_batch: usize) -> Self {
        self.max_batch = max_batch.max(1);
        self
    }

    /// Overrides the idle backoff applied when no messages are processed.
    #[must_use]
    pub fn with_idle_backoff(mut self, backoff: Duration) -> Self {
        self.idle_backoff = backoff;
        self
    }
}

/// Builder assembling the watcher processor with optional instrumentation hooks.
pub struct WatcherProcessorBuilder {
    jetstream: JetStreamClient,
    planner: PlannerClient,
    config: WatcherProcessorConfig,
    outcome_tx: Option<UnboundedSender<RecordedWatcherOutcome>>,
}

impl WatcherProcessorBuilder {
    /// Creates a builder using defaults derived from the supplied JetStream configuration.
    #[must_use]
    pub fn new(jetstream: JetStreamClient, planner: PlannerClient) -> Self {
        let config = WatcherProcessorConfig::from_jetstream(jetstream.config());
        Self {
            jetstream,
            planner,
            config,
            outcome_tx: None,
        }
    }

    /// Overrides the processor configuration.
    #[must_use]
    pub fn with_config(mut self, config: WatcherProcessorConfig) -> Self {
        self.config = config;
        self
    }

    /// Attaches an outcome channel used for observability or testing.
    #[must_use]
    pub fn with_outcome_channel(mut self, tx: UnboundedSender<RecordedWatcherOutcome>) -> Self {
        self.outcome_tx = Some(tx);
        self
    }

    /// Finalises the builder and returns a watcher processor.
    ///
    /// # Errors
    ///
    /// Returns [`WatcherProcessorError::JetStream`] when the processor consumer cannot be created on JetStream.
    pub async fn build(self) -> Result<WatcherProcessor, WatcherProcessorError> {
        let consumer = self
            .jetstream
            .pull_consumer(
                self.config.consumer_name.clone(),
                self.config.filter_subject.clone(),
            )
            .await?;

        Ok(WatcherProcessor {
            consumer,
            consumer_name: self.config.consumer_name,
            filter_subject: self.config.filter_subject,
            fetch_timeout: self.config.fetch_timeout,
            max_batch: self.config.max_batch,
            idle_backoff: self.config.idle_backoff,
            planner: Arc::new(self.planner),
            outcome_tx: self.outcome_tx,
        })
    }
}

/// Thin planner HTTP client used by the watcher processor.
#[derive(Clone)]
pub struct PlannerClient {
    http: reqwest::Client,
    endpoint: String,
}

impl PlannerClient {
    /// Constructs a planner client targeting the supplied endpoint.
    ///
    /// # Errors
    ///
    /// Returns [`PlannerClientError::InvalidUrl`] when the endpoint is empty or invalid,
    /// or [`PlannerClientError::BuildClient`] if the HTTP client cannot be constructed.
    pub fn new(endpoint: impl Into<String>) -> Result<Self, PlannerClientError> {
        let endpoint = endpoint.into();
        if endpoint.trim().is_empty() {
            return Err(PlannerClientError::InvalidUrl {
                endpoint,
                reason: "endpoint must not be empty".into(),
            });
        }

        if let Err(error) = reqwest::Url::parse(&endpoint) {
            return Err(PlannerClientError::InvalidUrl {
                endpoint,
                reason: error.to_string(),
            });
        }

        let http = reqwest::Client::builder()
            .user_agent("tyrum-watchers")
            .build()
            .map_err(|source| PlannerClientError::BuildClient { source })?;

        Ok(Self { http, endpoint })
    }

    /// Issues a plan request and returns the planner response.
    ///
    /// # Errors
    ///
    /// Returns a [`PlannerClientError`] when the planner request fails, returns a non-success status,
    /// or the response payload cannot be decoded.
    pub async fn invoke(&self, request: &PlanRequest) -> Result<PlanResponse, PlannerClientError> {
        let response = self
            .http
            .post(&self.endpoint)
            .json(request)
            .send()
            .await
            .map_err(|source| PlannerClientError::Request { source })?;

        let status = response.status();
        if !status.is_success() {
            let body = response
                .text()
                .await
                .unwrap_or_else(|error| format!("failed to read planner body: {error}"));
            return Err(PlannerClientError::UnexpectedStatus { status, body });
        }

        response
            .json::<PlanResponse>()
            .await
            .map_err(|source| PlannerClientError::Decode { source })
    }
}

/// Worker consuming watcher events and invoking the planner.
pub struct WatcherProcessor {
    consumer: async_nats::jetstream::consumer::PullConsumer,
    consumer_name: String,
    filter_subject: String,
    fetch_timeout: Duration,
    max_batch: usize,
    idle_backoff: Duration,
    planner: Arc<PlannerClient>,
    outcome_tx: Option<UnboundedSender<RecordedWatcherOutcome>>,
}

impl WatcherProcessor {
    /// Returns the durable consumer used to pull watcher events.
    #[must_use]
    pub fn consumer_name(&self) -> &str {
        &self.consumer_name
    }

    /// Returns the subject filter subscribed to by the processor.
    #[must_use]
    pub fn filter_subject(&self) -> &str {
        &self.filter_subject
    }

    /// Processes at most one batch of watcher events. Returns `true` when at least one event was handled.
    ///
    /// # Errors
    ///
    /// Propagates [`WatcherProcessorError`] when JetStream operations fail or planner invocation for a message errors.
    pub async fn process_once(&self) -> Result<bool, WatcherProcessorError> {
        let mut messages = self
            .consumer
            .fetch()
            .max_messages(self.max_batch)
            .expires(self.fetch_timeout)
            .messages()
            .await
            .map_err(|source| {
                WatcherProcessorError::JetStream(JetStreamError::Fetch {
                    consumer: self.consumer_name.clone(),
                    source,
                })
            })?;

        let mut processed_any = false;

        while let Some(message) = messages.next().await {
            let message = message.map_err(|source| {
                WatcherProcessorError::JetStream(JetStreamError::Message {
                    consumer: self.consumer_name.clone(),
                    source,
                })
            })?;

            self.process_message(message).await?;
            processed_any = true;
        }

        Ok(processed_any)
    }

    /// Runs the processor until the provided shutdown future resolves.
    ///
    /// # Errors
    ///
    /// Returns [`WatcherProcessorError`] when JetStream access fails or planner invocation errors while processing messages.
    pub async fn run(
        &self,
        shutdown: impl Future<Output = ()> + Send + 'static,
    ) -> Result<(), WatcherProcessorError> {
        pin!(shutdown);

        loop {
            tokio::select! {
                result = self.process_once() => {
                    let processed = result?;
                    if !processed {
                        sleep(self.idle_backoff).await;
                    }
                }
                _ = &mut shutdown => {
                    info!(
                        consumer = %self.consumer_name,
                        subject = %self.filter_subject,
                        "watcher processor received shutdown signal"
                    );
                    return Ok(());
                }
            }
        }
    }

    async fn process_message(
        &self,
        message: JetStreamMessage,
    ) -> Result<(), WatcherProcessorError> {
        let subject = message.message.subject.to_string();
        let payload = message.message.payload.clone();
        let event = self.parse_event(&payload)?;

        // TODO(security): enforce per-watcher authentication and rate limiting.
        let response = self.planner.invoke(&event.plan_request).await?;

        self.record_outcome(&event, &response);
        self.ack_message(message).await?;

        info!(
            event_id = %event.event_id,
            watcher_id = event.watcher_id,
            plan_reference = %event.plan_reference,
            subject = %subject,
            "processed watcher event and acknowledged message"
        );

        Ok(())
    }

    fn parse_event(&self, payload: &[u8]) -> Result<WatcherEvent, WatcherProcessorError> {
        serde_json::from_slice(payload)
            .map_err(|source| WatcherProcessorError::Deserialize { source })
    }

    fn record_outcome(&self, event: &WatcherEvent, response: &PlanResponse) {
        if let Some(tx) = &self.outcome_tx {
            let outcome = RecordedWatcherOutcome {
                event: event.clone(),
                response: response.clone(),
            };

            if tx.send(outcome).is_err() {
                warn!(
                    event_id = %event.event_id,
                    "watcher outcome channel dropped; skipping record"
                );
            }
        }
    }

    async fn ack_message(&self, message: JetStreamMessage) -> Result<(), WatcherProcessorError> {
        message.ack().await.map_err(|source| {
            WatcherProcessorError::JetStream(JetStreamError::Ack {
                consumer: self.consumer_name.clone(),
                source,
            })
        })
    }
}
