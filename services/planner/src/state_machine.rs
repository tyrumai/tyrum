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
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
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
    pub fn new(total_steps: usize) -> Self {
        Self {
            total_steps,
            executed_steps: 0,
            status: PlanStatus::Draft,
        }
    }

    /// Returns the current plan status.
    pub fn status(&self) -> &PlanStatus {
        &self.status
    }

    /// Total steps contained in the plan.
    pub fn total_steps(&self) -> usize {
        self.total_steps
    }

    /// Steps executed so far.
    pub fn executed_steps(&self) -> usize {
        self.executed_steps
    }

    /// Applies a planner event and returns the updated status on success.
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
            (
                S::Ready { .. }
                | S::AwaitingPostcondition { .. }
                | S::AwaitingHumanConfirmation { .. },
                E::Cancelled { detail },
            ) => {
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
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
