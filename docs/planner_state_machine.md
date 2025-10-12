# Planner State Machine

The planner emits a neutral sequence of action primitives. The control-plane coordinates their
execution through a small finite-state machine exposed by the `tyrum-planner` crate. This document
summarises the public API so executors, policy, and observability services can consume identical
semantics.

## States
- **Draft** – plan is being assembled; no policy checks have been initiated.
- **AwaitingPolicyReview** – plan has been submitted to the policy gate and is blocked until a
  decision is returned.
- **Ready** – the planner may dispatch the next primitive (`next_step_index`).
- **AwaitingPostcondition** – an executor is running the dispatched primitive and must report a
  postcondition outcome (success or failure).
- **AwaitingHumanConfirmation** – the plan is paused on a `Confirm` primitive pending the user’s
  decision.
- **Succeeded** – every primitive has been executed and all postconditions passed. The terminal
  payload is [`PlanSuccess`](../services/planner/src/state_machine.rs) with completion metadata.
- **Failed** – the plan aborted. The terminal payload is [`PlanFailure`](../services/planner/src/state_machine.rs).

## Events
The [`PlanEvent`](../services/planner/src/state_machine.rs) enum captures the wire events that drive
state transitions. Events fall into three buckets:

- **Progress events:** `SubmittedForPolicy`, `PolicyApproved`, `StepDispatched`,
  `PostconditionSatisfied`, `RequiresHumanConfirmation`, `HumanApproved`.
- **Failure events:** `PolicyDenied`, `HumanRejected`, `PostconditionFailed`, `ExecutorFailed`,
  `Cancelled`.
- **Observation events:** `PostconditionSatisfied` signals executor success, while
  `PostconditionFailed` captures the structured failure from the executor or postcondition runner.

## Success & Failure Documentation
- A plan succeeds only after every step emits `PostconditionSatisfied` (or `HumanApproved` for a
  confirm step). `PlanSuccess.steps_executed` records how many primitives were completed alongside a
  `completed_at` timestamp for audit replay.
- `PlanFailure` centralises failure reporting. The `reason` enum maps to observability dashboards and
  retry logic, `detail` carries executor/policy context, and `step_index` points at the failing
  primitive when available.
- Executors must populate `detail` for `PostconditionFailed` and `ExecutorFailed` events to keep the
  audit trail actionable. Higher layers surface the same payloads to the audit console.

This state machine is versioned in code; downstream services should prefer the Rust types (or their
serialized JSON) instead of copying the schema into bespoke representations.

## Postcondition Evaluation
- Executors must evaluate action postconditions through the shared
  `tyrum_shared::postconditions` module to keep assertion semantics consistent.
- The initial assertion set covers HTTP status codes, DOM text predicates, and JSONPath equality
  checks. Additional assertion kinds should be added in the shared library before individual
  executors start emitting them.
- Evaluation results surface as structured `PostconditionReport`s with sensitive values redacted.
  Failed assertions use deterministic codes (`unsupported_postcondition`, `dom_text_missing`, etc.)
  so the planner and observability pipelines can react consistently.

## Risk Classification Stub
- `services/risk_classifier` hosts a deterministic, file-driven classifier used to score spend
  intents before dispatch. The stub exposes both a synchronous API (used in-process by the planner)
  and an Axum router at `POST /risk/score` for future containerisation.
- Enable the classifier by pointing `PLANNER_RISK_CLASSIFIER_CONFIG` at a TOML or YAML weights file
  when launching `planner_http`. If the variable is unset or invalid, the planner skips risk scoring
  without affecting the happy path.
- When enabled, the planner enriches `PlanOutcomeAudit` with a `risk` block that records the verdict
  (`low`, `medium`, or `high`), the rounded confidence, and sanitized rationales. These entries are
  persisted in the event log alongside policy, discovery, and wallet audits.
- Spend thresholds and tag weights are deterministic and local-only. The default stub config lives
  at `services/risk_classifier/config/default_weights.toml`; edits to this file should be reviewed
  with policy to ensure guardrails remain transparent.
