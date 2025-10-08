use std::{convert::TryFrom, fmt};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Planner-level events that cause state transitions.
#[allow(clippy::exhaustive_enums)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlanEvent {
    SubmittedForPolicy,
    PolicyApproved,
    PolicyDenied {
        detail: String,
    },
    StepDispatched {
        step_index: usize,
    },
    RequiresHumanConfirmation {
        step_index: usize,
    },
    HumanApproved {
        step_index: usize,
    },
    HumanRejected {
        step_index: usize,
        detail: Option<String>,
    },
    PostconditionSatisfied {
        step_index: usize,
    },
    PostconditionFailed {
        step_index: usize,
        detail: String,
    },
    ExecutorFailed {
        step_index: usize,
        detail: String,
    },
    Cancelled {
        detail: Option<String>,
    },
}

/// Lifecycle phases for a plan.
#[allow(clippy::exhaustive_enums)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlanStatus {
    Draft,
    AwaitingPolicyReview,
    Ready { next_step_index: usize },
    AwaitingHumanConfirmation { step_index: usize },
    AwaitingPostcondition { step_index: usize },
    Succeeded(PlanSuccess),
    Failed(PlanFailure),
}

/// Success envelope emitted once every step has completed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanSuccess {
    pub completed_at: DateTime<Utc>,
    pub steps_executed: usize,
}

/// Failure envelope emitted on denials, user cancellations, or executor faults.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanFailure {
    pub occurred_at: DateTime<Utc>,
    pub step_index: Option<usize>,
    pub reason: PlanFailureReason,
    pub detail: Option<String>,
}

/// Categorised failure reason for telemetry and retry logic.
#[allow(clippy::exhaustive_enums)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlanFailureReason {
    PolicyDenied,
    UserDeclined,
    PostconditionFailed,
    ExecutorFailed,
    Cancelled,
}

/// Error returned when an event does not align with the current plan state.
#[derive(thiserror::Error, Debug, PartialEq, Eq)]
#[error("event {event:?} is invalid while plan state is {state:?}")]
pub struct PlanTransitionError {
    pub state: PlanStatus,
    pub event: PlanEvent,
}

/// Finite-state machine describing planner execution progress.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanStateMachine {
    total_steps: usize,
    executed_steps: usize,
    status: PlanStatus,
}

impl PlanStateMachine {
    /// Initialise a new plan machine for a plan consisting of `total_steps` primitives.
    #[must_use]
    pub fn new(total_steps: usize) -> Self {
        Self {
            total_steps,
            executed_steps: 0,
            status: PlanStatus::Draft,
        }
    }

    /// Returns the current plan status.
    #[must_use]
    pub fn status(&self) -> &PlanStatus {
        &self.status
    }

    /// Total steps contained in the plan.
    #[must_use]
    pub fn total_steps(&self) -> usize {
        self.total_steps
    }

    /// Steps executed so far.
    #[must_use]
    pub fn executed_steps(&self) -> usize {
        self.executed_steps
    }

    /// Applies a planner event and returns the updated status on success.
    ///
    /// # Errors
    ///
    /// Returns [`PlanTransitionError`] when the event is incompatible with the current state.
    pub fn apply(&mut self, event: PlanEvent) -> Result<&PlanStatus, PlanTransitionError> {
        use PlanEvent as E;
        use PlanFailureReason as Failure;
        use PlanStatus as S;

        match (&self.status, &event) {
            (S::Draft, E::SubmittedForPolicy) => {
                self.status = S::AwaitingPolicyReview;
            }
            (S::AwaitingPolicyReview, E::PolicyApproved) => {
                if self.total_steps == 0 {
                    self.status = S::Succeeded(PlanSuccess {
                        completed_at: Utc::now(),
                        steps_executed: 0,
                    });
                } else {
                    self.status = S::Ready {
                        next_step_index: self.executed_steps,
                    };
                }
            }
            (S::AwaitingPolicyReview, E::PolicyDenied { detail }) => {
                self.status = S::Failed(PlanFailure {
                    occurred_at: Utc::now(),
                    step_index: None,
                    reason: Failure::PolicyDenied,
                    detail: Some(detail.clone()),
                });
            }
            (S::Ready { next_step_index }, E::StepDispatched { step_index })
                if step_index == next_step_index =>
            {
                self.status = S::AwaitingPostcondition {
                    step_index: *step_index,
                };
            }
            (S::Ready { next_step_index }, E::RequiresHumanConfirmation { step_index })
                if step_index == next_step_index =>
            {
                self.status = S::AwaitingHumanConfirmation {
                    step_index: *step_index,
                };
            }
            (S::AwaitingHumanConfirmation { step_index }, E::HumanApproved { step_index: evt })
                if evt == step_index =>
            {
                self.executed_steps += 1;
                self.advance_or_complete();
            }
            (
                S::AwaitingHumanConfirmation { step_index },
                E::HumanRejected {
                    step_index: evt,
                    detail,
                },
            ) if evt == step_index => {
                self.status = S::Failed(PlanFailure {
                    occurred_at: Utc::now(),
                    step_index: Some(*step_index),
                    reason: Failure::UserDeclined,
                    detail: detail.clone(),
                });
            }
            (
                S::AwaitingPostcondition { step_index },
                E::PostconditionSatisfied { step_index: evt },
            ) if evt == step_index => {
                self.executed_steps += 1;
                self.advance_or_complete();
            }
            (
                S::AwaitingPostcondition { step_index },
                E::PostconditionFailed {
                    step_index: evt,
                    detail,
                },
            ) if evt == step_index => {
                self.status = S::Failed(PlanFailure {
                    occurred_at: Utc::now(),
                    step_index: Some(*step_index),
                    reason: Failure::PostconditionFailed,
                    detail: Some(detail.clone()),
                });
            }
            (
                S::AwaitingPostcondition { step_index },
                E::ExecutorFailed {
                    step_index: evt,
                    detail,
                },
            ) if evt == step_index => {
                self.status = S::Failed(PlanFailure {
                    occurred_at: Utc::now(),
                    step_index: Some(*step_index),
                    reason: Failure::ExecutorFailed,
                    detail: Some(detail.clone()),
                });
            }
            (S::AwaitingPostcondition { step_index }, E::Cancelled { detail }) => {
                self.status = S::Failed(PlanFailure {
                    occurred_at: Utc::now(),
                    step_index: Some(*step_index),
                    reason: Failure::Cancelled,
                    detail: detail.clone(),
                });
            }
            (S::AwaitingHumanConfirmation { step_index }, E::Cancelled { detail }) => {
                self.status = S::Failed(PlanFailure {
                    occurred_at: Utc::now(),
                    step_index: Some(*step_index),
                    reason: Failure::Cancelled,
                    detail: detail.clone(),
                });
            }
            (S::Ready { .. }, E::Cancelled { detail }) => {
                self.status = S::Failed(PlanFailure {
                    occurred_at: Utc::now(),
                    step_index: None,
                    reason: Failure::Cancelled,
                    detail: detail.clone(),
                });
            }
            _ => {
                return Err(PlanTransitionError {
                    state: self.status.clone(),
                    event,
                });
            }
        }

        self.emit_failure_log(&event);

        Ok(&self.status)
    }

    fn advance_or_complete(&mut self) {
        if self.executed_steps >= self.total_steps {
            self.status = PlanStatus::Succeeded(PlanSuccess {
                completed_at: Utc::now(),
                steps_executed: self.executed_steps,
            });
        } else {
            self.status = PlanStatus::Ready {
                next_step_index: self.executed_steps,
            };
        }
    }

    #[allow(clippy::cognitive_complexity)]
    fn emit_failure_log(&self, event: &PlanEvent) {
        use tracing::{error, warn};

        let PlanStatus::Failed(failure) = &self.status else {
            return;
        };

        let detail = failure.detail.as_deref().unwrap_or("");
        let (step_index, step_index_known) = match failure.step_index {
            Some(idx) => match i64::try_from(idx) {
                Ok(value) => (value, true),
                Err(_) => (i64::MAX, false),
            },
            None => (-1, false),
        };
        let executed_steps = self.executed_steps;
        let total_steps = self.total_steps;
        let reason = failure.reason;

        match reason {
            PlanFailureReason::PolicyDenied => warn!(
                target: "tyrum::planner",
                %reason,
                step_index,
                step_index_known,
                executed_steps,
                total_steps,
                event = ?event,
                detail,
                "plan aborted due to policy denial"
            ),
            PlanFailureReason::ExecutorFailed => error!(
                target: "tyrum::planner",
                %reason,
                step_index,
                step_index_known,
                executed_steps,
                total_steps,
                event = ?event,
                detail,
                "plan aborted due to executor failure"
            ),
            _ => {}
        }
    }
}

impl fmt::Display for PlanFailureReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let label = match self {
            Self::PolicyDenied => "policy_denied",
            Self::UserDeclined => "user_declined",
            Self::PostconditionFailed => "postcondition_failed",
            Self::ExecutorFailed => "executor_failed",
            Self::Cancelled => "cancelled",
        };
        f.write_str(label)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]

    use super::*;
    use serde_json::Value;
    use std::{
        io,
        sync::{Arc, Mutex},
    };
    use tracing_subscriber::{fmt, layer::SubscriberExt, registry::Registry};

    #[derive(Clone, Default)]
    struct JsonLogSink {
        buffer: Arc<Mutex<Vec<u8>>>,
    }

    impl JsonLogSink {
        fn take(&self) -> Vec<Value> {
            let mut guard = self.buffer.lock().expect("acquire log buffer");
            let bytes = std::mem::take(&mut *guard);
            drop(guard);

            if bytes.is_empty() {
                return Vec::new();
            }

            let content = String::from_utf8(bytes).expect("logs utf8");
            content
                .lines()
                .filter(|line| !line.trim().is_empty())
                .map(|line| serde_json::from_str(line).expect("json log line"))
                .collect()
        }
    }

    struct JsonLogWriter {
        buffer: Arc<Mutex<Vec<u8>>>,
    }

    impl<'a> fmt::MakeWriter<'a> for JsonLogSink {
        type Writer = JsonLogWriter;

        fn make_writer(&'a self) -> Self::Writer {
            JsonLogWriter {
                buffer: Arc::clone(&self.buffer),
            }
        }
    }

    impl io::Write for JsonLogWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            let mut guard = self.buffer.lock().expect("acquire writer buffer");
            guard.extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    fn collect_failure_logs<F>(operation: F) -> Vec<Value>
    where
        F: FnOnce(),
    {
        let sink = JsonLogSink::default();
        let layer = fmt::layer()
            .json()
            .with_ansi(false)
            .without_time()
            .with_writer(sink.clone());
        let subscriber = Registry::default().with(layer);

        tracing::subscriber::with_default(subscriber, operation);

        sink.take()
    }

    #[test]
    fn happy_path_through_execution() {
        let mut machine = PlanStateMachine::new(2);
        machine
            .apply(PlanEvent::SubmittedForPolicy)
            .expect("policy submission");
        machine
            .apply(PlanEvent::PolicyApproved)
            .expect("policy approval");
        assert_eq!(machine.status(), &PlanStatus::Ready { next_step_index: 0 });

        machine
            .apply(PlanEvent::StepDispatched { step_index: 0 })
            .expect("dispatch step 0");
        assert_eq!(
            machine.status(),
            &PlanStatus::AwaitingPostcondition { step_index: 0 }
        );
        machine
            .apply(PlanEvent::PostconditionSatisfied { step_index: 0 })
            .expect("postcondition satisfied");
        assert_eq!(machine.status(), &PlanStatus::Ready { next_step_index: 1 });

        machine
            .apply(PlanEvent::RequiresHumanConfirmation { step_index: 1 })
            .expect("require human confirmation");
        machine
            .apply(PlanEvent::HumanApproved { step_index: 1 })
            .expect("human approved");

        match machine.status() {
            PlanStatus::Succeeded(success) => {
                assert_eq!(success.steps_executed, 2);
            }
            other => panic!("unexpected terminal status: {other:?}"),
        }
    }

    #[test]
    fn policy_denial_short_circuits_plan() {
        let mut machine = PlanStateMachine::new(1);
        machine
            .apply(PlanEvent::SubmittedForPolicy)
            .expect("policy submission");
        machine
            .apply(PlanEvent::PolicyDenied {
                detail: "missing consent".into(),
            })
            .expect("policy rejection");

        match machine.status() {
            PlanStatus::Failed(failure) => {
                assert!(matches!(failure.reason, PlanFailureReason::PolicyDenied));
                assert_eq!(failure.detail.as_deref(), Some("missing consent"));
            }
            other => panic!("expected failure, saw {other:?}"),
        }
    }

    #[test]
    fn invalid_transition_returns_error() {
        let mut machine = PlanStateMachine::new(1);
        let err = machine
            .apply(PlanEvent::PolicyApproved)
            .expect_err("transition should fail");
        assert!(matches!(err.state, PlanStatus::Draft));
        assert!(matches!(err.event, PlanEvent::PolicyApproved));
    }

    #[test]
    fn cancellation_preserves_active_step_index() {
        let mut machine = PlanStateMachine::new(1);
        machine
            .apply(PlanEvent::SubmittedForPolicy)
            .expect("policy submission");
        machine
            .apply(PlanEvent::PolicyApproved)
            .expect("policy approval");
        machine
            .apply(PlanEvent::StepDispatched { step_index: 0 })
            .expect("dispatch step");

        machine
            .apply(PlanEvent::Cancelled {
                detail: Some("user stopped".into()),
            })
            .expect("cancelled plan");

        match machine.status() {
            PlanStatus::Failed(failure) => {
                assert_eq!(failure.step_index, Some(0));
                assert_eq!(failure.detail.as_deref(), Some("user stopped"));
                assert!(matches!(failure.reason, PlanFailureReason::Cancelled));
            }
            other => panic!("expected failure, saw {other:?}"),
        }
    }

    #[test]
    fn cancellation_from_ready_has_no_step_index() {
        let mut machine = PlanStateMachine::new(2);
        machine
            .apply(PlanEvent::SubmittedForPolicy)
            .expect("policy submission");
        machine
            .apply(PlanEvent::PolicyApproved)
            .expect("policy approval");

        machine
            .apply(PlanEvent::Cancelled { detail: None })
            .expect("cancel plan");

        match machine.status() {
            PlanStatus::Failed(failure) => {
                assert_eq!(failure.step_index, None);
                assert!(matches!(failure.reason, PlanFailureReason::Cancelled));
            }
            other => panic!("expected failure, saw {other:?}"),
        }
    }

    #[test]
    fn policy_denial_emits_structured_log() {
        let logs = collect_failure_logs(|| {
            let mut machine = PlanStateMachine::new(1);
            machine
                .apply(PlanEvent::SubmittedForPolicy)
                .expect("policy submission");
            machine
                .apply(PlanEvent::PolicyDenied {
                    detail: "missing consent".into(),
                })
                .expect("policy rejection");
        });

        let entry = logs
            .iter()
            .find(|log| log["fields"]["reason"] == "policy_denied")
            .expect("policy denial log emitted");

        assert_eq!(entry["level"], "WARN");
        assert_eq!(entry["fields"]["detail"], "missing consent");
        assert_eq!(entry["fields"]["total_steps"], 1);
        assert_eq!(entry["fields"]["executed_steps"], 0);
        assert_eq!(entry["fields"]["step_index"], -1);
        assert_eq!(entry["fields"]["step_index_known"], false);
        assert!(
            entry["fields"]["event"]
                .as_str()
                .unwrap()
                .contains("PolicyDenied")
        );
    }

    #[test]
    fn executor_failure_emits_structured_log() {
        let logs = collect_failure_logs(|| {
            let mut machine = PlanStateMachine::new(1);
            machine
                .apply(PlanEvent::SubmittedForPolicy)
                .expect("policy submission");
            machine
                .apply(PlanEvent::PolicyApproved)
                .expect("policy approval");
            machine
                .apply(PlanEvent::StepDispatched { step_index: 0 })
                .expect("dispatch step");
            machine
                .apply(PlanEvent::ExecutorFailed {
                    step_index: 0,
                    detail: "playwright crashed".into(),
                })
                .expect("executor failure");
        });

        let entry = logs
            .iter()
            .find(|log| log["fields"]["reason"] == "executor_failed")
            .expect("executor failure log emitted");

        assert_eq!(entry["level"], "ERROR");
        assert_eq!(entry["fields"]["detail"], "playwright crashed");
        assert_eq!(entry["fields"]["step_index"], 0);
        assert_eq!(entry["fields"]["step_index_known"], true);
        assert_eq!(entry["fields"]["total_steps"], 1);
        assert_eq!(entry["fields"]["executed_steps"], 0);
        assert!(
            entry["fields"]["event"]
                .as_str()
                .unwrap()
                .contains("ExecutorFailed")
        );
    }
}
