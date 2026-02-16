# Planner State Machine

The planner emits a neutral sequence of action primitives. The control-plane coordinates their
execution through a small finite-state machine exposed by the planner module. This document
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
  payload is a `PlanResponse` with `status: "success"` and completion metadata.
- **Failed** – the plan aborted. The terminal payload is a `PlanResponse` with
  `status: "failure"` and structured error details.

## Events
Planner events drive state transitions. Events fall into three buckets:

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

This state machine is versioned in code; downstream services should prefer the shared
schema types in `packages/schemas/src/planner.ts` (or their serialized JSON) instead
of copying the schema into bespoke representations.

## Postcondition Evaluation
- Executors must evaluate action postconditions through the shared
  `@tyrum/schemas` postcondition utilities to keep assertion semantics consistent.
- The initial assertion set covers HTTP status codes, DOM text predicates, and JSONPath equality
  checks. Additional assertion kinds should be added in the shared library before individual
  executors start emitting them.
- Evaluation results surface as structured `PostconditionReport`s with sensitive values redacted.
  Failed assertions use deterministic codes (`unsupported_postcondition`, `dom_text_missing`, etc.)
  so the planner and observability pipelines can react consistently.

## Risk Classification Stub
- `packages/gateway/src/modules/risk/classifier.ts` hosts a deterministic, file-driven classifier
  used to score spend intents before dispatch. The classifier currently runs in-process with the
  gateway.
- Risk scoring uses normalized threshold and tag-weight configuration. When configuration is missing
  or incomplete, the classifier falls back to conservative defaults without affecting the happy path.
- When enabled, the planner enriches `PlanOutcomeAudit` with a `risk` block that records the verdict
  (`low`, `medium`, or `high`), the rounded confidence, and sanitized rationales. These entries are
  persisted in the event log alongside policy, discovery, and wallet audits.
- Spend thresholds and tag weights are deterministic and local-only. Review changes with policy to
  ensure guardrails remain transparent.
