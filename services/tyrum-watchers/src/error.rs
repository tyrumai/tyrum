use thiserror::Error;

/// Errors raised by the JetStream watcher client utilities.
#[derive(Debug, Error)]
pub enum JetStreamError {
    /// An expected environment variable was not provided.
    #[error("missing environment variable {key}")]
    MissingEnv {
        /// The missing environment variable key.
        key: &'static str,
    },
    /// The configured stream name failed validation.
    #[error("invalid stream name `{stream}`: {reason}")]
    InvalidStreamName {
        /// The invalid stream name that was provided.
        stream: String,
        /// Short description of why the value is invalid.
        reason: &'static str,
    },
    /// The configured subject prefix failed validation.
    #[error("invalid subject prefix `{subject}`: {reason}")]
    InvalidSubjectPrefix {
        /// The invalid subject prefix that was provided.
        subject: String,
        /// Short description of why the value is invalid.
        reason: &'static str,
    },
    /// The configured consumer name failed validation.
    #[error("invalid consumer name `{consumer}`: {reason}")]
    InvalidConsumerName {
        /// The invalid consumer name that was provided.
        consumer: String,
        /// Short description of why the value is invalid.
        reason: &'static str,
    },
    /// Establishing the underlying NATS connection failed.
    #[error("failed to connect to NATS JetStream")]
    Connect {
        /// The source error returned by the async-nats client.
        #[source]
        source: async_nats::ConnectError,
    },
    /// Creating or fetching the configured JetStream stream failed.
    #[error("failed to create or fetch stream `{stream}`")]
    Stream {
        /// Stream identifier that failed.
        stream: String,
        /// The source error from async-nats.
        #[source]
        source: async_nats::jetstream::context::CreateStreamError,
    },
    /// Creating or fetching the configured JetStream consumer failed.
    #[error("failed to create or fetch consumer `{consumer}`")]
    Consumer {
        /// Consumer identifier that failed.
        consumer: String,
        /// The source error from async-nats.
        #[source]
        source: async_nats::jetstream::stream::ConsumerError,
    },
    /// Publishing a message to JetStream failed.
    #[error("failed to publish to subject `{subject}`")]
    Publish {
        /// Subject that publish attempted to use.
        subject: String,
        /// The source error returned by async-nats.
        #[source]
        source: async_nats::jetstream::context::PublishError,
    },
    /// Fetching messages for the configured consumer failed.
    #[error("failed to fetch messages for consumer `{consumer}`")]
    Fetch {
        /// Consumer identifier involved in the fetch operation.
        consumer: String,
        /// The source error from async-nats.
        #[source]
        source: async_nats::jetstream::consumer::pull::BatchError,
    },
    /// Processing a message pulled from JetStream failed.
    #[error("failed to process message for consumer `{consumer}`")]
    Message {
        /// Consumer identifier involved in the message iteration.
        consumer: String,
        /// The source error from async-nats.
        #[source]
        source: async_nats::Error,
    },
    /// Acknowledging a message back to JetStream failed.
    #[error("failed to acknowledge message for consumer `{consumer}`")]
    Ack {
        /// Consumer identifier involved in the acknowledgement.
        consumer: String,
        /// The source error from async-nats.
        #[source]
        source: async_nats::Error,
    },
    /// Retrieving JetStream account information failed.
    #[error("failed to query JetStream account information")]
    Account {
        /// The source error from async-nats.
        #[source]
        source: async_nats::jetstream::context::AccountError,
    },
}

/// Errors encountered when invoking the planner service.
#[derive(Debug, Error)]
pub enum PlannerClientError {
    /// The configured planner endpoint could not be parsed.
    #[error("invalid planner endpoint `{endpoint}`: {reason}")]
    InvalidUrl {
        /// Planner endpoint that failed validation.
        endpoint: String,
        /// Cause describing why the URL was rejected.
        reason: String,
    },
    /// Making an HTTP request to the planner failed.
    #[error("planner request failed")]
    Request {
        /// Underlying reqwest error.
        #[source]
        source: reqwest::Error,
    },
    /// Constructing the planner HTTP client failed.
    #[error("failed to construct planner HTTP client")]
    BuildClient {
        /// Underlying reqwest error.
        #[source]
        source: reqwest::Error,
    },
    /// Planner responded with a non-success status code.
    #[error("planner returned unexpected status {status}: {body}")]
    UnexpectedStatus {
        /// HTTP status reported by the planner.
        status: reqwest::StatusCode,
        /// Body returned in the unexpected response.
        body: String,
    },
    /// Decoding the planner response payload failed.
    #[error("failed to decode planner response")]
    Decode {
        /// Underlying decode error.
        #[source]
        source: reqwest::Error,
    },
}

/// Errors surfaced while processing watcher events.
#[derive(Debug, Error)]
pub enum WatcherProcessorError {
    /// JetStream operations failed for the watcher processor.
    #[error(transparent)]
    JetStream(#[from] JetStreamError),
    /// Payload parsing failed when deserializing a watcher event.
    #[error("failed to deserialize watcher event payload")]
    Deserialize {
        /// Serde error describing the parse failure.
        #[source]
        source: serde_json::Error,
    },
    /// Planner invocation failed.
    #[error(transparent)]
    Planner(#[from] PlannerClientError),
}
