# Execution engine

The execution engine is the gateway subsystem responsible for turning a plan or workflow into **resilient, auditable execution**. It is where reliability guarantees live: retries, idempotency, budgets/timeouts, pause/resume, and evidence capture.

## Why it exists

LLMs are good at proposing plans, but they are a poor place to host the control plane for long-running, side-effecting work. The execution engine moves orchestration into a typed runtime so that:

- Side effects can be **paused** behind approvals and **resumed** safely without repeating completed work.
- Runs can be **retried** deterministically without duplicating actions.
- “Done” is backed by **postconditions + artifacts**, not narrative.
- Operator UIs can observe progress in real time via events.

## Responsibilities

- **Queueing and scheduling:** accept work from interactive sessions, cron jobs, hooks, and external triggers.
- **Run state machine:** track run lifecycle (`queued → running → paused|succeeded|failed|cancelled`) with durable persistence.
- **Step execution:** execute steps via the tool runtime and capability providers (nodes, MCP).
- **Idempotency + safe retries:** enforce `idempotency_key` semantics for side-effecting steps and define retry policies.
- **Approvals and pause/resume:** pause runs when an approval is required and resume using a durable resume token.
- **Budgets and timeouts:** enforce cost/time ceilings per run and per step (including model budgets where applicable).
- **Concurrency limits:** limit parallelism per agent, per lane, per capability provider, and globally.
- **Evidence and verification:** capture artifacts and validate postconditions (required for state-changing steps when feasible).
- **Intent and deviation checks:** validate side-effecting steps against recorded intent (ToolIntent/approvals/WorkItem constraints) and pause for operator clarification when execution drifts outside intent.
- **Rollback metadata:** store human-readable rollback hints and optional structured compensation actions (always approval-gated).
- **Auditability:** emit events for run/step lifecycle and persist a run log suitable for troubleshooting and export.

## Distributed execution (workers)

The execution engine can run co-located with the gateway edge (even in the same OS process) or be split into separate processes/hosts. To minimize surprises when scaling up, the same execution semantics apply in all deployments: workers claim/lease work in the StateStore and publish lifecycle events through the backplane abstraction (see [Scaling and High Availability](./scaling-ha.md)).

Cluster-safe execution typically requires:

- **Claim/lease:** workers claim work with a time-bounded lease recorded in the StateStore so only one worker executes a given attempt at a time.
- **Idempotency:** side-effecting steps define `idempotency_key` semantics so retries are safe under at-least-once execution.
- **Lane serialization:** workers acquire a distributed lock/lease keyed by `(session_key, lane)` before executing steps that must be serialized.
- **Durable outcomes:** attempt results, artifacts, and postcondition evaluations are persisted before emitting “completed” events.

Claimable work items carry explicit lease fields (for example `lease_owner` and `lease_expires_at`). Claims are atomic updates, leases are renewed periodically, and takeover occurs safely on expiry.

Lane serialization uses explicit lane lease rows keyed by `(session_key, lane)` with the same expiry/renew/takeover behavior as work leases.

Idempotency is durable dedupe with cached outcomes: when an executor observes a duplicate `(scope, kind, idempotency_key)`, it returns the stored outcome instead of repeating the side effect.

Retry policy is per-step with conservative defaults. Automatic retries apply only when idempotency semantics are enforced for the step.

## Workspace-backed execution (ToolRunner)

Many Tyrum steps are filesystem- or process-oriented (for example running a CLI tool in a workspace, reading/writing files, generating evidence artifacts). To keep the workspace directory durable across runs while still scaling to multi-node clusters, Tyrum treats workspace access as an explicit execution boundary:

- **ToolRunner** is the execution context that mounts the workspace filesystem and runs side-effecting tools.
- Workers coordinate work in the StateStore (claims/leases, idempotency, lane serialization) and delegate step execution to ToolRunner.

ToolRunner has deployment-parity implementations:

- **Single-host/desktop:** ToolRunner is a **local subprocess** (or in-process) operating on the local persistent workspace directory.
- **Cluster:** ToolRunner is a **sandboxed job/container** that mounts the workspace volume (with single-writer semantics) and writes outcomes back to the StateStore.

This keeps execution semantics identical while ensuring that long-lived edge/scheduler replicas do not need to mount shared workspace volumes.

## Non-responsibilities

- The execution engine does not decide _what_ to do from a user message (decision/proposal is in the agent loop; durable task tracking is in the WorkBoard).
- The execution engine does not implement device-specific automation (that lives behind node capabilities).
- The execution engine does not store raw secrets (that lives behind the secret provider).

## Core concepts

### Job vs run

- **Job:** the queued unit of work (created by a session request, cron, or hook).
- **Run:** an execution attempt of a job. A job can create multiple runs due to retries or operator-requested replays.

### Step and attempt

- **Step:** one atomic action in a workflow (for example “HTTP request”, “click button”, “send message”).
- **Attempt:** one execution attempt of a step (attempt count increments on retry).

### Pause/resume

When a run reaches a step that requires approval (or takeover), the engine:

1. Persists the run in a **paused** state.
2. Creates an **approval request** record.
3. Returns/emits a **resume token** that references the paused state.
4. Resumes only after the approval is resolved (approved/denied/expired).

Resume tokens are opaque identifiers (random ids) that map to paused-state rows in the StateStore. Tokens support expiry and revocation.

## Evidence + postconditions (hard rule)

For **state-changing** steps, a postcondition should be defined whenever a verification check is feasible. The engine is responsible for executing and evaluating the postcondition and storing evidence artifacts.

If a step cannot be verified automatically, the engine must:

- Mark the outcome as **unverifiable** (not “done”), and
- Escalate to the operator (approval/takeover) before proceeding with further dependent side effects.

Unverifiable outcomes are represented as a pause with stored reports describing missing evidence; they are not separate terminal statuses.

Postconditions are typed assertion kinds (not arbitrary expression evaluation). The core set stays small and explicit; extensions are registered via plugins/connectors and validated by contracts.

## Topology

```mermaid
flowchart TB
  Trigger["Trigger (session/cron/webhook/heartbeat/hook)"] --> Enqueue["Enqueue job"]
  Enqueue --> Engine["ExecutionEngine"]

  Engine -->|claim/lease| Worker["Worker"]
  Worker -->|execute step| ToolRunner["ToolRunner (workspace-mounted)"]
  ToolRunner --> Tools["ToolRuntime"]
  Tools --> Providers["CapabilityProviders (Node/MCP)"]

  Engine -->|pause| Approvals["ApprovalQueue"]
  Approvals -->|approve/deny| Engine

  Engine --> Evidence["Artifacts + Postconditions"]
  Engine --> Events["Events/AuditLog"]
  Engine <--> DB["StateStore (SQLite/Postgres)"]
  ToolRunner --> WorkspaceFs["WorkspaceFs (workspace root)"]
```

## Data model

Durable execution entities include:

- `Job`: created by a trigger; references agent/lane and input.
- `Run`: an execution attempt of a job; carries budgets and lifecycle timestamps/status.
- `RunStep`: ordered steps with kind, args, idempotency key, optional approval, and optional postcondition.
- `RunStepAttempt`: attempt-level results/errors and artifact references.

Exact schemas belong in versioned contracts.

## Observability and cost

- Structured logs include stable identifiers: `request_id`, `event_id`, `job_id`, `run_id`, `step_id`, `attempt_id`, and `approval_id`.
- Cost attribution (model tokens, executor time) is persisted per run/step/attempt so budgets and approvals can be evaluated and UIs can aggregate accurately.
- Deployments export tracing and metrics via OpenTelemetry.

## Client/UI expectations

Operator clients should be able to:

- See run progress as a timeline (queued/running/paused/completed).
- Inspect per-step evidence (artifacts) and postcondition results.
- Resolve approvals and resume/cancel paused runs.
- Request safe retries or rollbacks when supported.
