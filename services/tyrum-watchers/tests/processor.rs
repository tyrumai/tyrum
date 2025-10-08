#![allow(clippy::expect_used, clippy::unwrap_used)]

mod common;

use std::time::Duration;

use anyhow::{Context, Result};
use axum::{Json, Router, extract::State, routing::post};
use chrono::Utc;
use common::NatsFixture;
use serde_json::json;
use tokio::{
    net::TcpListener,
    sync::{mpsc, oneshot},
    time::timeout,
};
use tyrum_shared::{
    MessageContent, MessageSource, NormalizedMessage, NormalizedThread, NormalizedThreadMessage,
    PlanOutcome, PlanRequest, PlanResponse, PlanSummary, ThreadKind,
};
use tyrum_watchers::{
    JetStreamClient, JetStreamConfig, PlannerClient, RecordedWatcherOutcome, WatcherEvent,
    WatcherProcessorBuilder, WatcherProcessorConfig,
};

const SAMPLE_STREAM: &str = "watchers_processor_stream";
const SAMPLE_SUBJECT_PREFIX: &str = "watchers.test";
const SAMPLE_SAMPLE_CONSUMER: &str = "watchers_test_sample";
const SAMPLE_PROCESSOR_CONSUMER: &str = "watchers_test_processor";
const SAMPLE_CLIENT: &str = "tyrum-watchers-test";

#[tokio::test]
async fn watcher_processor_invokes_planner_and_records_outcome() -> Result<()> {
    let fixture = match NatsFixture::start().await {
        Ok(fixture) => fixture,
        Err(err) => {
            if err
                .chain()
                .any(|cause| cause.to_string().contains("No such file or directory"))
            {
                eprintln!(
                    "skipping watcher_processor_invokes_planner_and_records_outcome: docker socket unavailable ({err})"
                );
                return Ok(());
            }

            return Err(err);
        }
    };

    let config = JetStreamConfig::new(
        fixture.url().to_string(),
        SAMPLE_STREAM,
        SAMPLE_SUBJECT_PREFIX,
        SAMPLE_SAMPLE_CONSUMER,
        SAMPLE_PROCESSOR_CONSUMER,
        SAMPLE_CLIENT,
    )?;

    let jetstream = JetStreamClient::connect(config.clone()).await?;

    let plan_request = sample_plan_request();
    let sample_response = sample_plan_response(&plan_request);
    let mut planner = PlannerStub::start(sample_response.clone()).await?;
    let planner_client = PlannerClient::new(planner.url())?;

    let mut processor_config = WatcherProcessorConfig::from_jetstream(&config);
    processor_config = processor_config.with_fetch_timeout(Duration::from_millis(100));

    let (outcome_tx, mut outcome_rx) = mpsc::unbounded_channel::<RecordedWatcherOutcome>();

    let processor = WatcherProcessorBuilder::new(jetstream.clone(), planner_client)
        .with_config(processor_config)
        .with_outcome_channel(outcome_tx)
        .build()
        .await?;

    let watcher_event = WatcherEvent {
        event_id: "evt-123".into(),
        watcher_id: 42,
        plan_reference: "demo-plan".into(),
        plan_request: plan_request.clone(),
        metadata: json!({"source": "test"}),
    };

    let subject = format!("{}.calendar", config.subject_prefix());
    let payload = serde_json::to_vec(&watcher_event)?;
    jetstream.publish(subject.clone(), &payload).await?;

    let processed = processor.process_once().await?;
    assert!(processed, "expected watcher processor to handle a message");

    let recorded_request = timeout(Duration::from_secs(2), planner.recv_request())
        .await?
        .expect("planner request expected");
    assert_eq!(recorded_request.request_id, plan_request.request_id);

    let recorded_outcome = timeout(Duration::from_secs(2), outcome_rx.recv())
        .await?
        .expect("watcher outcome expected");
    assert_eq!(recorded_outcome.event.event_id, watcher_event.event_id);
    assert_eq!(recorded_outcome.response.plan_id, sample_response.plan_id);

    let second_pass = processor.process_once().await?;
    assert!(
        !second_pass,
        "no additional watcher events should remain after acknowledgement"
    );

    planner.shutdown().await;

    Ok(())
}

fn sample_plan_request() -> PlanRequest {
    let thread_id = "thread-123".to_string();
    let message_id = "msg-456".to_string();

    PlanRequest {
        request_id: "req-789".into(),
        subject_id: "subject-1".into(),
        trigger: NormalizedThreadMessage {
            thread: NormalizedThread {
                id: thread_id.clone(),
                kind: ThreadKind::Private,
                title: None,
                username: None,
                pii_fields: vec![],
            },
            message: NormalizedMessage {
                id: message_id.clone(),
                thread_id,
                source: MessageSource::Telegram,
                content: MessageContent::Text {
                    text: "Calendar conflict detected".into(),
                },
                sender: None,
                timestamp: Utc::now(),
                edited_timestamp: None,
                pii_fields: vec![],
            },
        },
        locale: Some("en-US".into()),
        timezone: Some("Europe/Amsterdam".into()),
        tags: vec!["watcher".into(), "calendar".into()],
    }
}

fn sample_plan_response(request: &PlanRequest) -> PlanResponse {
    PlanResponse {
        plan_id: "plan-001".into(),
        request_id: request.request_id.clone(),
        created_at: Utc::now(),
        trace_id: Some("trace-123".into()),
        outcome: PlanOutcome::Success {
            steps: vec![],
            summary: PlanSummary {
                synopsis: Some("Notified user about schedule conflict".into()),
            },
        },
    }
}

#[derive(Clone)]
struct PlannerStubState {
    sender: mpsc::UnboundedSender<PlanRequest>,
    response: PlanResponse,
}

struct PlannerStub {
    base_url: String,
    requests_rx: mpsc::UnboundedReceiver<PlanRequest>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    handle: tokio::task::JoinHandle<()>,
}

impl PlannerStub {
    async fn start(response: PlanResponse) -> Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .context("bind planner stub listener")?;
        let address = listener.local_addr().context("read planner stub address")?;

        let (sender, requests_rx) = mpsc::unbounded_channel();
        let (shutdown_tx, shutdown_rx) = oneshot::channel();

        let state = PlannerStubState { sender, response };

        let app = Router::new()
            .route("/plan", post(plan_route))
            .with_state(state);

        let handle = tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_rx.await;
                })
                .await
            {
                tracing::warn!(%error, "planner stub server exited with error");
            }
        });

        Ok(Self {
            base_url: format!("http://{address}"),
            requests_rx,
            shutdown_tx: Some(shutdown_tx),
            handle,
        })
    }

    fn url(&self) -> String {
        format!("{}/plan", self.base_url)
    }

    async fn recv_request(&mut self) -> Option<PlanRequest> {
        self.requests_rx.recv().await
    }

    async fn shutdown(mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        let _ = self.handle.await;
    }
}

async fn plan_route(
    State(state): State<PlannerStubState>,
    Json(request): Json<PlanRequest>,
) -> Json<PlanResponse> {
    let _ = state.sender.send(request);
    Json(state.response.clone())
}
