# ADR-005: Execution API Design

**Status**: Accepted
**Date**: 2026-02-20

## Context

The execution engine (`modules/execution/engine.ts`, 1059 lines) implements
durable execution with `enqueuePlan()`, `resumeRun()`, `workerTick()`, lane and
workspace leases, idempotency records, postcondition evaluation, and retry logic.
However, there is no HTTP or WebSocket API surface exposing these capabilities.
Smoke tests insert DB rows directly. There are no lifecycle events emitted through
the backplane, no budget tracking, and no concurrency limits.

The gap analysis (ARI-008) identifies this as high risk because UIs, connectors,
and playbooks cannot reliably orchestrate work without a proper API.

## Decision

Expose the execution engine through HTTP routes and WebSocket request types, and
emit lifecycle events through the outbox/backplane.

**HTTP routes**:
- `POST /workflow/run` - Enqueue a new execution run (accepts steps, lane, key).
- `POST /workflow/resume` - Resume a paused run with a resume token.
- `POST /workflow/cancel` - Cancel a running or paused run.
- `GET /workflow/runs` - List runs with filtering (status, lane, date range).
- `GET /workflow/runs/:id` - Get run detail including steps and current state.

**WebSocket request types** (for clients preferring WS-first interaction):
- `workflow.run`, `workflow.resume`, `workflow.cancel` - mirror the HTTP routes.

**Lifecycle events** emitted through the outbox/backplane:
- `run.queued`, `run.started`, `run.completed`, `run.failed`, `run.paused`
- `step.started`, `step.completed`, `step.failed`

Events are published to typed outbox topics and delivered to connected clients via
the existing backplane polling mechanism.

**Budget tracking**: Each run carries `budget_tokens` (max allowed) and
`spent_tokens` (accumulated). The engine checks budget before each step and pauses
the run with `reason=budget_exceeded` when the limit is reached.

**Concurrency limits**: Per-lane concurrency limits prevent resource exhaustion.
The engine skips lanes that are at capacity during `workerTick()`.

**Feature flag**: `TYRUM_WORKFLOW_API` (default on). The legacy plan runner
remains available during migration but is not exposed through new routes.

## Consequences

### Positive
- UIs, connectors, and playbooks can orchestrate execution through a stable API.
- Lifecycle events enable real-time dashboards, notifications, and audit.
- Budget enforcement prevents runaway cost from long-running or looping runs.
- Concurrency limits protect shared infrastructure from noisy neighbors.

### Negative
- API surface increases the attack surface; routes require auth and input validation.
- Event emission adds write overhead per step transition.
- Legacy plan runner must be maintained in parallel during migration.

### Risks
- Budget tracking accuracy depends on cost reporting from step executors. If a
  step executor underreports cost, budget enforcement is ineffective. Mitigated
  by: conservative default budgets, operator alerts on high-cost runs.
- Event storms from high-throughput lanes could overwhelm the outbox poller.
  Mitigated by: batched polling, backpressure on event consumers, per-lane
  rate limiting.
