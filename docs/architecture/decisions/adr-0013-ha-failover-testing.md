# ADR-0013: HA and failover testing strategy

Status:

Accepted (2026-02-19)

## Context

As Tyrum scales to multi-instance deployments (replicated edges/workers/schedulers with HA Postgres), correctness depends on well-defined behavior under failures (process crashes, retries, partitions, and database failover).

Without explicit tests, HA regressions are easy to introduce (especially around leases, outbox delivery, and approvals).

## Decision

We will define and maintain an explicit **failure matrix** and implement **automated integration tests** that cover, at minimum:

- Edge instance crash/restart while clients are connected
- Worker crash/restart during an in-flight attempt (lease expiry/takeover)
- Scheduler crash/restart (no double-fires; leases transfer)
- DB transient failures and restart/failover behavior
- Network partitions between components (edge↔DB, worker↔DB)

These tests become required gates for changes that touch coordination primitives.
## Consequences

- Adds CI complexity (requires Postgres + multi-process orchestration), but materially reduces enterprise reliability risk.
- Forces us to specify expected behavior for in-flight runs and approvals.

