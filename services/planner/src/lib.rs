//! Core primitives shared between the planner service and its dependants.

pub mod action;
pub mod event_log;
pub mod state_machine;

pub use action::{ActionArguments, ActionPostcondition, ActionPrimitive, ActionPrimitiveKind};
pub use event_log::{
    AppendOutcome, EventLog, EventLogError, EventLogSettings, NewPlannerEvent,
    PersistedPlannerEvent,
};
pub use state_machine::{
    PlanEvent, PlanFailure, PlanFailureReason, PlanStateMachine, PlanStatus, PlanSuccess,
};
