# Architecture gaps / open questions

Status:

This document tracks architecture areas that are still **missing**, **ambiguous**, or **need further design**. It is meant to stay current and should be updated as decisions are made.

## Workflow runtime (playbooks)

- **Schema/DSL finalization:** exact YAML/JSON schema, validation rules, and compatibility/versioning story.
- **Step types mapping:** how `steps[].command` maps to tool calls/capabilities (CLI vs tool invocation vs node RPC), and what is allowed by default.
- **Pipeline string support:** whether inline “pipeline strings” are supported long-term or only workflow files.
- **Output model:** what is `stdout` vs `json` output in Tyrum terms; parsing rules; how output caps are enforced per step.
- **Resume token storage:** where paused state is stored (SQLite vs filesystem), token format, expiry, and revocation.
- **LLM JSON steps:** whether they are supported in playbooks, and if so, how budgets, determinism expectations, and policy apply.

## Execution engine

- **Run state machine:** final run/step statuses and transitions (including partial success and “unverifiable” outcomes).
- **Retry policy:** per-step retry rules, backoff, and when to stop vs escalate.
- **Idempotency contract:** what `idempotency_key` means across tools/capabilities and how it is enforced.
- **Rollback metadata:** how reversible actions are represented and exposed to operators.
- **Concurrency limits:** per-agent, per-lane, per-capability, and global limits.
- **Persistence schemas:** final tables/contracts for jobs/runs/steps/attempts/artifacts.

## Approvals

- **Approval object model:** baseline schema is pinned down in `@tyrum/schemas` (`Approval`, `ApprovalResolution`, status/kind enums); remaining work includes preview UX defaults and tightening invariants across run/step identity vs legacy `plan_id`.
- **Events/contracts:** `approval.request`, `approval.list`, and `approval.resolve` request/response contracts are pinned down; remaining work includes durable approval audit events and stable event payload schemas for “requested/resolved/expired”.
- **Notification UX:** where/how approvals are surfaced (control panel, channel pings) and deep-link format.

## Secrets

- **Secret provider API:** baseline handle + store/list/resolve/revoke contracts are pinned down; remaining work includes rotate semantics and a permission model.
- **Backend choices:** OS keychain vs encrypted file vs external password managers; migration story.
- **Injection path:** how secrets are injected into node executors without leaking into logs/model context.
- **Redaction pipeline:** guaranteed redaction points for tool output, artifacts, and event payloads.

## Evidence and postconditions

- **Postcondition schema:** supported assertion types (DOM, HTTP, filesystem diff, message delivery, etc).
- **Artifact store:** storage location, retention, export bundles, and references. Baseline `ArtifactRef` / `artifact://…` contract is pinned down; store + retention are still open.
- **“Unverifiable” semantics:** how the system reports and blocks dependency chains when verification isn’t possible.

## Multi-agent routing and isolation

- **Isolation boundaries:** workspace, memory, sessions, tools, and secrets per agent; enforcement mechanism.
- **Routing rules:** how channel accounts and inbound containers map to `agentId`.
- **Key taxonomy details:** baseline key syntax is pinned down (`TyrumKey`); remaining work includes connector-specific conventions for `<channel>` and `<id>`.

## Client control panel

- **Chat tab semantics:** how sessions are listed/selected, and how lane/run progress is rendered.
- **Audit timeline UX:** what is shown by default; how artifacts are browsed; search/filter behavior.
- **Node management UX:** pairing flows, trust levels, revocation, and per-node capability scopes.

## Security and policy

- **Prompt/tool injection model:** provenance tagging, policy rules based on provenance, and safe defaults.
- **Sandbox model:** how tool policy, sandboxing, and elevated execution interact.
- **Network egress control:** domain allowlists and how they’re configured/audited.

## Observability

- **Tracing/metrics:** what is emitted, where it’s collected, and what SLOs are targeted.
- **Cost attribution:** how token usage and executor time are attributed per run/step.

## Scaling and high availability

- **StateStore portability:** define the compatibility bar for SQLite vs Postgres (schema features allowed, JSON/array usage, transaction semantics, locking expectations).
- **Migration story:** how a local SQLite StateStore can be migrated to Postgres (one-time export/import, live dual-write, or “new deployment only”).
- **Worker claim/lease model:** canonical claim/lease fields, expiry/renewal, poison job handling, and backoff semantics under retries.
- **Lane serialization mechanism:** how `(session_key, lane)` exclusivity is enforced in multi-instance deployments (advisory locks vs lease rows; failure and takeover behavior).
- **Event backplane choice:** outbox schema and delivery semantics; how to combine outbox durability with low-latency pub/sub; replay strategy for reconnecting clients.
- **WebSocket connection routing:** how cross-instance delivery works when a client/node is connected to a different gateway edge instance (connection directory, message routing, and revocation).
- **Scheduler DB-leases:** how cron/watchers/heartbeat are coordinated to prevent double-fires (sharding, leases, and durable dedupe ids).
- **Artifact store scaling:** local filesystem vs object store; retention policies; artifact reference formats and export bundles.
- **HA / failover testing:** define what failures must be tolerated (single instance crash, DB failover, partition) and the expected behavior for in-flight runs and approvals.
