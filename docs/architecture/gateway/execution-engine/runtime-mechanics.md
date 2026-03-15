---
slug: /architecture/execution-engine/runtime-mechanics
---

# Execution runtime mechanics

## Parent concept

- [Execution engine](/architecture/execution-engine)

## Scope

This page describes the lower-level mechanics that make execution durable and replay-safe: work claims, leases, idempotency, lane serialization, ToolRunner delegation, and pause/resume behavior. It complements the execution-engine overview and does not redefine higher-level responsibilities.

## Claim and lease lifecycle

Execution work is claimed through durable StateStore updates so at most one worker owns a given attempt at a time.

- claims are atomic and record `lease_owner` plus an expiry timestamp
- workers renew leases while actively executing
- takeover happens only after expiry and must tolerate duplicate observation
- completed work persists its outcome before the lease is released

The same lease model applies whether execution is co-located with the gateway or split across worker processes.

## Idempotency and retry mechanics

State-changing steps rely on durable idempotency keys:

- the executor normalizes a step's dedupe scope and `idempotency_key`
- duplicate observations return the stored outcome instead of replaying the side effect
- automatic retries are enabled only for steps whose idempotency semantics are defined
- retries preserve attempt history so operators can inspect the original failure and the recovery path

Idempotency is part of the execution contract, not an optimization.

## Lane serialization

Some execution must remain serialized per `(session_key, lane)` to avoid transcript or tool races.

- workers acquire a lane lease before executing serialized work
- leases are renewed while the run is active
- safe takeover occurs on expiry
- queued follow-up work remains durable while the lane is busy

This keeps interactive and background lanes consistent across single-node and clustered deployments.

## ToolRunner delegation boundary

ToolRunner is the execution boundary for filesystem- and process-oriented work:

- workers coordinate queue state, approvals, and retries in the StateStore
- ToolRunner performs the actual workspace-mounted tool execution
- outcomes, artifacts, and postcondition reports are written back before completion events are emitted

This separation keeps the workspace durable without forcing every gateway replica to mount it directly.

## Pause, resume, and cancellation

Approvals and other stop conditions use durable pause state:

1. the run transitions to `paused`
2. the engine persists approval or blocker metadata
3. a resume token or durable reference points back to the paused state
4. resumption continues from the persisted step boundary instead of replaying completed work

Cancellation follows the same durability rule: intent is recorded first, then execution is interrupted at a safe boundary.

## Failure and recovery model

- duplicate deliveries are expected and must be deduped
- worker death is recovered through lease expiry and reassignment
- paused runs remain inspectable and resumable after restarts
- outbox/event delivery may replay, but durable run state remains authoritative

## Observability

The mechanics above should remain visible through stable identifiers and events:

- `job_id`, `run_id`, `step_id`, `attempt_id`, and `approval_id`
- lease ownership and expiry timestamps in operational diagnostics
- lifecycle events for queue, claim, pause, resume, retry, and completion transitions

## Related docs

- [Execution engine](/architecture/execution-engine)
- [Approvals](/architecture/approvals)
- [Artifacts](/architecture/artifacts)
- [WorkBoard delegated execution](/architecture/workboard/delegated-execution)
- [Scaling and High Availability](/architecture/scaling-ha)
