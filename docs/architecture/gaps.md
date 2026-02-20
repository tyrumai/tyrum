# Architecture gaps / open questions

Status:

This document tracks architecture areas that are still **missing**, **ambiguous**, or **need further design**. It is meant to stay current and should be updated as decisions are made.

As architecture decisions are accepted, we record them as ADRs under [`docs/architecture/decisions/`](./decisions/index.md) and annotate this document accordingly.

## Workflow runtime (playbooks)

Resolved by [ADR-0005](./decisions/adr-0005-playbook-dsl.md).

- (Resolved) **Schema/DSL finalization:** exact YAML/JSON schema, validation rules, and compatibility/versioning story.
- (Resolved) **Step types mapping:** how `steps[].command` maps to tool calls/capabilities (CLI vs tool invocation vs node RPC), and what is allowed by default.
- (Resolved) **Pipeline string support:** whether inline “pipeline strings” are supported long-term or only workflow files.
- (Resolved) **Output model:** what is `stdout` vs `json` output in Tyrum terms; parsing rules; how output caps are enforced per step.
- (Resolved) **Resume token storage:** where paused state is stored (SQLite vs filesystem), token format, expiry, and revocation.
- (Resolved) **LLM steps:** whether they are supported in playbooks, and how budgets, determinism expectations, and policy apply.

## Execution engine

Resolved by [ADR-0004](./decisions/adr-0004-execution-engine-coordination.md).

- (Resolved) **Run state machine:** final run/step statuses and transitions (including partial success and “unverifiable” outcomes).
- (Resolved) **Retry policy:** per-step retry rules, backoff, and when to stop vs escalate.
- (Resolved) **Idempotency contract:** what `idempotency_key` means across tools/capabilities and how it is enforced.
- (Resolved) **Rollback metadata:** how reversible actions are represented and exposed to operators.
- (Resolved) **Concurrency limits:** per-agent, per-lane, per-capability, and global limits.
- (Resolved) **Persistence schemas:** final tables/contracts for jobs/runs/steps/attempts/artifacts.

## Approvals

Resolved by [ADR-0006](./decisions/adr-0006-approvals.md).

- (Resolved) **Approval object model:** baseline schema is pinned down in `@tyrum/schemas` (`Approval`, `ApprovalResolution`, status/kind enums); remaining work includes preview UX defaults and tightening invariants across run/step identity vs legacy `plan_id`.
- (Resolved) **Events/contracts:** `approval.request`, `approval.list`, and `approval.resolve` request/response contracts are pinned down; remaining work includes durable approval audit events and stable event payload schemas for “requested/resolved/expired”.
- (Resolved) **Notification UX:** where/how approvals are surfaced (control panel, channel pings) and deep-link format.

## Secrets

Resolved by [ADR-0007](./decisions/adr-0007-secrets.md).

- (Resolved) **Secret provider API:** baseline handle + store/list/resolve/revoke contracts are pinned down; remaining work includes rotate semantics and a permission model.
- (Resolved) **Backend choices:** OS keychain vs encrypted file vs external password managers; migration story.
- (Resolved) **Injection path:** how secrets are injected into node executors without leaking into logs/model context.
- (Resolved) **Redaction pipeline:** guaranteed redaction points for tool output, artifacts, and event payloads.

## Evidence and postconditions

Resolved by [ADR-0004](./decisions/adr-0004-execution-engine-coordination.md) and [ADR-0008](./decisions/adr-0008-artifacts.md).

- (Resolved) **Postcondition schema:** supported assertion types (DOM, HTTP, filesystem diff, message delivery, etc).
- (Resolved) **Artifact store:** storage location, retention, export bundles, and references. Baseline `ArtifactRef` / `artifact://…` contract is pinned down; store + retention are still open.
- (Resolved) **“Unverifiable” semantics:** how the system reports and blocks dependency chains when verification isn’t possible.

## Multi-agent routing and isolation

Resolved by [ADR-0012](./decisions/adr-0012-multi-agent-routing.md).

- (Resolved) **Isolation boundaries:** workspace, memory, sessions, tools, and secrets per agent; enforcement mechanism.
- (Resolved) **Routing rules:** how channel accounts and inbound containers map to `agentId`.
- (Resolved) **Key taxonomy details:** baseline key syntax is pinned down (`TyrumKey`); remaining work includes connector-specific conventions for `<channel>` and `<id>`.

## Client control panel

- (Open) **Chat tab semantics:** how sessions are listed/selected, and how lane/run progress is rendered.

Resolved by [ADR-0011](./decisions/adr-0011-control-panel-ux.md).

- (Resolved) **Audit timeline UX:** what is shown by default; how artifacts are browsed; search/filter behavior.
- (Resolved) **Node management UX:** pairing flows, trust levels, revocation, and per-node capability scopes.

## Security and policy

Resolved by [ADR-0009](./decisions/adr-0009-security-model.md).

- (Resolved) **Prompt/tool injection model:** provenance tagging, policy rules based on provenance, and safe defaults.
- (Resolved) **Sandbox model:** how tool policy, sandboxing, and elevated execution interact.
- (Resolved) **Network egress control:** domain allowlists and how they’re configured/audited.

## Observability

Resolved by [ADR-0010](./decisions/adr-0010-observability-and-cost.md).

- (Resolved) **Tracing/metrics:** what is emitted, where it’s collected, and what SLOs are targeted.
- (Resolved) **Cost attribution:** how token usage and executor time are attributed per run/step.

## Scaling and high availability

Resolved by [ADR-0002](./decisions/adr-0002-statestore-backends.md), [ADR-0003](./decisions/adr-0003-backplane-and-ws-routing.md), [ADR-0004](./decisions/adr-0004-execution-engine-coordination.md), [ADR-0008](./decisions/adr-0008-artifacts.md), and [ADR-0013](./decisions/adr-0013-ha-failover-testing.md).

- (Resolved) **StateStore portability:** define the compatibility bar for SQLite vs Postgres (schema features allowed, JSON/array usage, transaction semantics, locking expectations).
- (Resolved) **Migration story:** how a local SQLite StateStore can be migrated to Postgres (one-time export/import, live dual-write, or “new deployment only”).
- (Resolved) **Worker claim/lease model:** canonical claim/lease fields, expiry/renewal, poison job handling, and backoff semantics under retries.
- (Resolved) **Lane serialization mechanism:** how `(session_key, lane)` exclusivity is enforced in multi-instance deployments (advisory locks vs lease rows; failure and takeover behavior).
- (Resolved) **Event backplane choice:** outbox schema and delivery semantics; how to combine outbox durability with low-latency pub/sub; replay strategy for reconnecting clients.
- (Resolved) **WebSocket connection routing:** how cross-instance delivery works when a client/node is connected to a different gateway edge instance (connection directory, message routing, and revocation).
- (Resolved) **Scheduler DB-leases:** how cron/watchers/heartbeat are coordinated to prevent double-fires (sharding, leases, and durable dedupe ids).
- (Resolved) **Artifact store scaling:** local filesystem vs object store; retention policies; artifact reference formats and export bundles.
- (Resolved) **HA / failover testing:** define what failures must be tolerated (single instance crash, DB failover, partition) and the expected behavior for in-flight runs and approvals.
