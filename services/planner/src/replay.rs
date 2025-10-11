use std::collections::BTreeSet;

use chrono::Utc;
use opentelemetry::{global, metrics::Counter};
use serde::Serialize;
use serde_json::{Value, json};
use thiserror::Error;
use tracing::warn;
use uuid::Uuid;

use crate::state_machine::PlanTransitionError;
use crate::{
    ActionPrimitive, ActionPrimitiveKind, EventLog, EventLogError, PlanEvent, PlanStateMachine,
};
use tyrum_memory::{MemoryDal, MemoryError, NewEpisodicEvent, NewFact};

/// Encapsulates OpenTelemetry counters emitted by the replay sandbox.
#[derive(Clone)]
pub struct ReplayMetrics {
    steps_total: Counter<u64>,
    failures_total: Counter<u64>,
}

impl ReplayMetrics {
    /// Construct metrics using the process-wide OpenTelemetry meter.
    #[must_use]
    pub fn global() -> Self {
        let meter = global::meter("tyrum-planner.replay");
        Self {
            steps_total: meter
                .u64_counter("replay.steps_total")
                .with_description("Count of planner steps replayed by the sandbox")
                .build(),
            failures_total: meter
                .u64_counter("replay.failures_total")
                .with_description("Count of replayed steps whose outcomes diverged")
                .build(),
        }
    }

    fn record_step(&self) {
        self.steps_total.add(1, &[]);
    }

    fn record_failure(&self) {
        self.failures_total.add(1, &[]);
    }
}

impl Default for ReplayMetrics {
    fn default() -> Self {
        Self::global()
    }
}

/// Outcome of replaying an individual plan step.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ReplayMismatch {
    pub step_index: usize,
    pub primitive: ActionPrimitive,
    pub expected_executor: String,
    pub actual_executor: String,
    pub expected_result: Value,
    pub actual_result: Value,
    pub diffs: Vec<ValueDiff>,
}

/// JSON pointer diff entry describing divergence between two values.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ValueDiff {
    pub path: String,
    pub expected: Value,
    pub actual: Value,
}

/// Aggregated report containing replay outcomes.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ReplayReport {
    pub plan_id: Uuid,
    pub steps_replayed: usize,
    pub mismatches: Vec<ReplayMismatch>,
}

impl ReplayReport {
    /// Returns `true` when no divergences were detected.
    #[must_use]
    pub fn succeeded(&self) -> bool {
        self.mismatches.is_empty()
    }
}

/// Domain error produced while loading or replaying plan traces.
#[derive(Debug, Error)]
pub enum ReplayError {
    #[error("plan {plan_id} has no recorded steps")]
    EmptyTrace { plan_id: Uuid },
    #[error("negative step index {step_index} in trace")]
    NegativeStepIndex { step_index: i32 },
    #[error("trace step {step_index} missing {field}")]
    MissingField {
        step_index: usize,
        field: &'static str,
    },
    #[error("invalid primitive payload for step {step_index}: {source}")]
    Decode {
        step_index: usize,
        #[source]
        source: serde_json::Error,
    },
    #[error("unsupported primitive {kind:?} at step {step_index}")]
    UnsupportedPrimitive {
        kind: ActionPrimitiveKind,
        step_index: usize,
    },
    #[error(transparent)]
    EventLog(#[from] EventLogError),
    #[error(transparent)]
    Memory(#[from] MemoryError),
    #[error("plan state machine rejected transition: {0}")]
    StateTransition(#[from] PlanTransitionError),
}

/// Orchestrates plan replay using stored planner traces.
pub struct ReplaySandbox {
    event_log: EventLog,
    memory: MemoryDal,
    metrics: ReplayMetrics,
}

impl ReplaySandbox {
    /// Construct a new replay sandbox that shares the planner event log and memory data stores.
    #[must_use]
    pub fn new(event_log: EventLog, memory: MemoryDal, metrics: ReplayMetrics) -> Self {
        Self {
            event_log,
            memory,
            metrics,
        }
    }

    /// Replay recorded planner steps and surface divergences between expected and stubbed outcomes.
    ///
    /// # Errors
    ///
    /// Returns [`ReplayError::EmptyTrace`] when no steps were found for the plan.
    /// Returns [`ReplayError::MissingField`] if required audit payload keys are absent.
    /// Propagates [`ReplayError::UnsupportedPrimitive`] when a primitive kind lacks a stub executor.
    /// Propagates storage errors from the event log or memory layers.
    pub async fn replay_plan(
        &self,
        plan_id: Uuid,
        subject_id: Option<Uuid>,
    ) -> Result<ReplayReport, ReplayError> {
        let mut events = self.event_log.events_for_plan(plan_id).await?;
        if events.is_empty() {
            return Err(ReplayError::EmptyTrace { plan_id });
        }

        // discard plan-level audit payloads (step index sentinel)
        events.retain(|event| event.step_index != i32::MAX);

        if events.is_empty() {
            return Err(ReplayError::EmptyTrace { plan_id });
        }

        let mut steps = Vec::with_capacity(events.len());
        for event in events {
            if event.step_index < 0 {
                return Err(ReplayError::NegativeStepIndex {
                    step_index: event.step_index,
                });
            }
            let step_index = usize::try_from(event.step_index).unwrap_or_default();
            let primitive_value =
                event
                    .action
                    .get("primitive")
                    .cloned()
                    .ok_or(ReplayError::MissingField {
                        step_index,
                        field: "primitive",
                    })?;
            let primitive = serde_json::from_value::<ActionPrimitive>(primitive_value)
                .map_err(|source| ReplayError::Decode { step_index, source })?;

            let expected_executor = event
                .action
                .get("executor")
                .and_then(Value::as_str)
                .ok_or(ReplayError::MissingField {
                    step_index,
                    field: "executor",
                })?
                .to_string();

            let expected_result =
                event
                    .action
                    .get("result")
                    .cloned()
                    .ok_or(ReplayError::MissingField {
                        step_index,
                        field: "result",
                    })?;

            steps.push(ReplayStep {
                step_index,
                primitive,
                expected_executor,
                expected_result,
            });
        }

        let mut machine = PlanStateMachine::new(steps.len());
        machine.apply(PlanEvent::SubmittedForPolicy)?;
        machine.apply(PlanEvent::PolicyApproved)?;

        let mut report = ReplayReport {
            plan_id,
            steps_replayed: 0,
            mismatches: Vec::new(),
        };
        if subject_id.is_none() {
            warn!(
                "subject id not provided; replay will skip memory hydration for capability facts"
            );
        }
        let executors = StubExecutors::new(self.memory.clone(), subject_id);

        for step in steps {
            self.metrics.record_step();
            report.steps_replayed += 1;

            if let Some(mismatch) = self.execute_step(&mut machine, &executors, &step).await? {
                self.metrics.record_failure();
                report.mismatches.push(mismatch);
                break;
            }
        }

        Ok(report)
    }

    async fn execute_step(
        &self,
        machine: &mut PlanStateMachine,
        executors: &StubExecutors,
        step: &ReplayStep,
    ) -> Result<Option<ReplayMismatch>, ReplayError> {
        match step.primitive.kind {
            ActionPrimitiveKind::Confirm => {
                machine.apply(PlanEvent::RequiresHumanConfirmation {
                    step_index: step.step_index,
                })?
            }
            _ => machine.apply(PlanEvent::StepDispatched {
                step_index: step.step_index,
            })?,
        };

        let outcome = executors.execute(step.step_index, &step.primitive).await?;

        let mut diffs = diff_values(&step.expected_result, &outcome.result);
        if step.expected_executor != outcome.executor {
            diffs.push(ValueDiff {
                path: "/executor".into(),
                expected: Value::String(step.expected_executor.clone()),
                actual: Value::String(outcome.executor.clone()),
            });
        }

        if diffs.is_empty() {
            match step.primitive.kind {
                ActionPrimitiveKind::Confirm => machine.apply(PlanEvent::HumanApproved {
                    step_index: step.step_index,
                })?,
                _ => machine.apply(PlanEvent::PostconditionSatisfied {
                    step_index: step.step_index,
                })?,
            };
            return Ok(None);
        }

        let detail = describe_diffs(&diffs);
        match step.primitive.kind {
            ActionPrimitiveKind::Confirm => machine.apply(PlanEvent::HumanRejected {
                step_index: step.step_index,
                detail: Some(detail.clone()),
            })?,
            _ => machine.apply(PlanEvent::PostconditionFailed {
                step_index: step.step_index,
                detail: detail.clone(),
            })?,
        };

        let mismatch = ReplayMismatch {
            step_index: step.step_index,
            primitive: step.primitive.clone(),
            expected_executor: step.expected_executor.clone(),
            actual_executor: outcome.executor,
            expected_result: step.expected_result.clone(),
            actual_result: outcome.result,
            diffs,
        };

        Ok(Some(mismatch))
    }
}

struct ReplayStep {
    step_index: usize,
    primitive: ActionPrimitive,
    expected_executor: String,
    expected_result: Value,
}

struct StubExecutors {
    memory: MemoryDal,
    subject_id: Option<Uuid>,
}

impl StubExecutors {
    fn new(memory: MemoryDal, subject_id: Option<Uuid>) -> Self {
        Self { memory, subject_id }
    }

    async fn execute(
        &self,
        step_index: usize,
        primitive: &ActionPrimitive,
    ) -> Result<StubOutcome, ReplayError> {
        match primitive.kind {
            ActionPrimitiveKind::Confirm => self.handle_confirm(primitive).await,
            ActionPrimitiveKind::Web => self.handle_web(primitive).await,
            ActionPrimitiveKind::Message => self.handle_message(primitive).await,
            other => Err(ReplayError::UnsupportedPrimitive {
                kind: other,
                step_index,
            }),
        }
    }

    async fn handle_confirm(
        &self,
        _primitive: &ActionPrimitive,
    ) -> Result<StubOutcome, ReplayError> {
        let decision = json!({ "decision": "approved" });

        if let Some(subject_id) = self.subject_id {
            self.record_confirmation_event(subject_id, decision.clone())
                .await;
        }

        Ok(StubOutcome {
            executor: "human".into(),
            result: decision,
        })
    }

    async fn handle_web(&self, primitive: &ActionPrimitive) -> Result<StubOutcome, ReplayError> {
        let slot = primitive
            .args
            .get("slot")
            .cloned()
            .unwrap_or_else(|| json!({ "status": "unknown" }));

        if let Some(subject_id) = self.subject_id {
            self.record_web_fact(subject_id, &slot).await;
            self.record_web_event(subject_id, primitive, &slot).await;
        }

        let executor = primitive
            .args
            .get("executor")
            .and_then(Value::as_str)
            .unwrap_or("generic-web")
            .to_string();

        let result = match primitive.postcondition.clone() {
            Some(value) => value,
            None => json!({
                "assertions": [],
                "metadata": {
                    "slot": slot,
                    "status": "booked",
                }
            }),
        };

        Ok(StubOutcome { executor, result })
    }

    async fn handle_message(
        &self,
        primitive: &ActionPrimitive,
    ) -> Result<StubOutcome, ReplayError> {
        let channel = primitive
            .args
            .get("channel")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let recipient = primitive
            .args
            .get("recipient")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let body = primitive
            .args
            .get("body")
            .and_then(Value::as_str)
            .unwrap_or("");

        if let Some(subject_id) = self.subject_id {
            self.record_message_event(subject_id, &channel, &recipient, body)
                .await;
        }

        let result = primitive
            .postcondition
            .clone()
            .unwrap_or_else(|| json!({ "status": "delivered", "channel": channel }));

        Ok(StubOutcome {
            executor: "generic-message".into(),
            result,
        })
    }

    async fn record_confirmation_event(&self, subject_id: Uuid, payload: Value) {
        let result = self
            .memory
            .create_episodic_event(NewEpisodicEvent {
                subject_id,
                event_id: Uuid::new_v4(),
                occurred_at: Utc::now(),
                channel: "human".into(),
                event_type: "confirmation.response".into(),
                payload,
            })
            .await;
        if let Err(error) = result {
            warn!(%error, "failed to record confirmation episodic event");
        }
    }

    async fn record_web_fact(&self, subject_id: Uuid, slot: &Value) {
        let result = self
            .memory
            .create_fact(NewFact {
                subject_id,
                fact_key: "last_scheduled_call".into(),
                fact_value: json!({
                    "status": "booked",
                    "slot": slot.clone(),
                }),
                source: "replay-sandbox".into(),
                observed_at: Utc::now(),
                confidence: 1.0,
            })
            .await;
        if let Err(error) = result {
            warn!(%error, "failed to record capability memory fact");
        }
    }

    async fn record_web_event(&self, subject_id: Uuid, primitive: &ActionPrimitive, slot: &Value) {
        let payload = json!({
            "action": primitive.args.get("intent").cloned().unwrap_or(Value::Null),
            "slot": slot.clone(),
        });
        let result = self
            .memory
            .create_episodic_event(NewEpisodicEvent {
                subject_id,
                event_id: Uuid::new_v4(),
                occurred_at: Utc::now(),
                channel: "executor".into(),
                event_type: "executor.web".into(),
                payload,
            })
            .await;
        if let Err(error) = result {
            warn!(%error, "failed to record web executor episodic event");
        }
    }

    async fn record_message_event(
        &self,
        subject_id: Uuid,
        channel: &str,
        recipient: &str,
        body: &str,
    ) {
        let payload = json!({
            "to": recipient,
            "body": body,
        });
        let result = self
            .memory
            .create_episodic_event(NewEpisodicEvent {
                subject_id,
                event_id: Uuid::new_v4(),
                occurred_at: Utc::now(),
                channel: channel.into(),
                event_type: "message.sent".into(),
                payload,
            })
            .await;
        if let Err(error) = result {
            warn!(%error, "failed to record message episodic event");
        }
    }
}

struct StubOutcome {
    executor: String,
    result: Value,
}

fn diff_values(expected: &Value, actual: &Value) -> Vec<ValueDiff> {
    let mut diffs = Vec::new();
    collect_diffs(expected, actual, "".to_string(), &mut diffs);
    diffs
}

fn describe_diffs(diffs: &[ValueDiff]) -> String {
    if diffs.is_empty() {
        return "no diff".into();
    }

    diffs
        .iter()
        .map(|diff| {
            let expected = serde_json::to_string(&diff.expected).unwrap_or_else(|_| "<?>".into());
            let actual = serde_json::to_string(&diff.actual).unwrap_or_else(|_| "<?>".into());
            let path = if diff.path.is_empty() {
                "/".to_string()
            } else {
                diff.path.clone()
            };
            format!("{path}: expected {expected}, got {actual}")
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn collect_diffs(expected: &Value, actual: &Value, path: String, diffs: &mut Vec<ValueDiff>) {
    if expected == actual {
        return;
    }

    match (expected, actual) {
        (Value::Object(exp), Value::Object(act)) => {
            let keys: BTreeSet<_> = exp.keys().chain(act.keys()).cloned().collect();
            for key in keys {
                let child_path = join_path(&path, &key);
                match (exp.get(&key), act.get(&key)) {
                    (Some(e), Some(a)) => collect_diffs(e, a, child_path, diffs),
                    (Some(e), None) => diffs.push(ValueDiff {
                        path: child_path,
                        expected: e.clone(),
                        actual: Value::Null,
                    }),
                    (None, Some(a)) => diffs.push(ValueDiff {
                        path: child_path,
                        expected: Value::Null,
                        actual: a.clone(),
                    }),
                    (None, None) => {}
                }
            }
        }
        (Value::Array(exp), Value::Array(act)) => {
            let max_len = exp.len().max(act.len());
            for index in 0..max_len {
                let child_path = join_path(&path, &index.to_string());
                match (exp.get(index), act.get(index)) {
                    (Some(e), Some(a)) => collect_diffs(e, a, child_path, diffs),
                    (Some(e), None) => diffs.push(ValueDiff {
                        path: child_path,
                        expected: e.clone(),
                        actual: Value::Null,
                    }),
                    (None, Some(a)) => diffs.push(ValueDiff {
                        path: child_path,
                        expected: Value::Null,
                        actual: a.clone(),
                    }),
                    (None, None) => {}
                }
            }
        }
        _ => diffs.push(ValueDiff {
            path,
            expected: expected.clone(),
            actual: actual.clone(),
        }),
    }
}

fn join_path(parent: &str, segment: &str) -> String {
    let escaped = segment.replace('~', "~0").replace('/', "~1");
    if parent.is_empty() {
        format!("/{}", escaped)
    } else {
        format!("{}/{}", parent, escaped)
    }
}
