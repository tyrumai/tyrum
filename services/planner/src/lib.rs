//! Core primitives shared between the planner service and its dependants.

pub mod event_log;
pub mod http;
pub mod policy;
pub mod profiles;
pub mod state_machine;
pub mod wallet;

pub use event_log::{
    AppendOutcome, CapabilityMemoryResult, CapabilityMemorySkipReason, EventLog, EventLogError,
    EventLogSettings, NewPlannerEvent, PersistedPlannerEvent,
};
pub use policy::{PolicyClient, PolicyDecision, PolicyDecisionKind, PolicyRuleDecision};
pub use profiles::ProfileStore;
pub use state_machine::{
    PlanEvent, PlanFailure, PlanFailureReason, PlanStateMachine, PlanStatus, PlanSuccess,
};
pub use tyrum_shared::planner::{
    ActionArguments, ActionPostcondition, ActionPrimitive, ActionPrimitiveKind, PlanError,
    PlanErrorCode, PlanEscalation, PlanOutcome, PlanRequest, PlanResponse, PlanSummary,
    PlanUserContext,
};
pub use wallet::{AuthorizationDecision, SpendAuthorization, WalletClient, WalletClientError};
