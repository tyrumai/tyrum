# ADR-0010: Observability and cost attribution

Status:

Accepted (2026-02-19)

## Context

Tyrum must be operable across desktop and enterprise deployments. The execution engine requires auditability and real-time progress updates.

Cost attribution (tokens, model calls, executor time) is required for budgets and approvals.

## Decision

1. **Baseline observability** is **structured logs** with consistent identifiers:

   - `request_id`, `event_id`
   - `job_id`, `run_id`, `step_id`, `attempt_id`
   - `approval_id`

2. Support **optional OpenTelemetry** exporters for tracing/metrics in enterprise deployments.

3. Persist **cost attribution per run/step/attempt** in the StateStore so UIs and APIs can aggregate accurately.
## Consequences

- Desktop deployments remain lightweight (logs only) while enterprise can integrate with existing telemetry stacks.
- Attempt-level cost data becomes part of the execution contract and must remain stable.
