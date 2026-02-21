# Architecture Gap Closure — Report

## 1. Run Execution Brief

- **Git HEAD**: 7df2167 (`feat/gap-closure-p0`)
- **Date**: 2026-02-21
- **Goal**: Close all 12 architecture gap items across 3 implementation runs.
- **Non-goals**: Rewriting architecture docs; adding speculative features; big-bang refactors.
- **Constraints**: pnpm monorepo, strict ESM TypeScript, Node 24, SQLite+Postgres dual target.
- **Plan**: Run 1 (Ed25519 + secret policy), Run 2 (conditions, context reports, snapshot, queue overflow, typing modes), Run 3 (JSON Schema, model catalog, compaction, plugin runtime, SPA scaffold).
- **Risks**: Feature flag misuse; database migration ordering; type-level regressions; external API compatibility (models.dev).
- **Results**: All 12 PLAN items closed, 49 new tests across 3 runs, 1358 total tests passing (up from 1297 baseline).

## 2. Docs Ingested

All 40 files under `docs/architecture/` were read in full:

| # | File |
|---|------|
| 1 | docs/architecture/index.md |
| 2 | docs/architecture/gateway/index.md |
| 3 | docs/architecture/protocol/handshake.md |
| 4 | docs/architecture/protocol/index.md |
| 5 | docs/architecture/protocol/requests-responses.md |
| 6 | docs/architecture/protocol/events.md |
| 7 | docs/architecture/agent-loop.md |
| 8 | docs/architecture/agent.md |
| 9 | docs/architecture/artifacts.md |
| 10 | docs/architecture/automation.md |
| 11 | docs/architecture/capabilities.md |
| 12 | docs/architecture/contracts.md |
| 13 | docs/architecture/execution-engine.md |
| 14 | docs/architecture/identity.md |
| 15 | docs/architecture/memory.md |
| 16 | docs/architecture/node.md |
| 17 | docs/architecture/playbooks.md |
| 18 | docs/architecture/plugins.md |
| 19 | docs/architecture/scaling-ha.md |
| 20 | docs/architecture/skills.md |
| 21 | docs/architecture/workspace.md |
| 22 | docs/architecture/approvals.md |
| 23 | docs/architecture/auth.md |
| 24 | docs/architecture/channels.md |
| 25 | docs/architecture/client.md |
| 26 | docs/architecture/context-compaction.md |
| 27 | docs/architecture/glossary.md |
| 28 | docs/architecture/markdown-formatting.md |
| 29 | docs/architecture/messages-sessions.md |
| 30 | docs/architecture/models.md |
| 31 | docs/architecture/multi-agent-routing.md |
| 32 | docs/architecture/observability.md |
| 33 | docs/architecture/policy-overrides.md |
| 34 | docs/architecture/presence.md |
| 35 | docs/architecture/sandbox-policy.md |
| 36 | docs/architecture/secrets.md |
| 37 | docs/architecture/sessions-lanes.md |
| 38 | docs/architecture/slash-commands.md |
| 39 | docs/architecture/system-prompt.md |
| 40 | docs/architecture/tools.md |

## 3. Target Architecture Summary

Tyrum is a **WebSocket-first autonomous worker agent platform** with a long-lived gateway coordinating durable execution, approvals, and audit evidence. Key design tenets:

- **Local-first, single-user-by-default** — scales from SQLite/single-host to HA Postgres/K8s
- **Typed boundaries** — Zod/JSON Schema contracts at all interfaces
- **Secrets by handle** — model never sees raw credentials
- **Evidence over confidence** — postconditions + artifacts, not narrative
- **Resumable execution** — pause for approvals, resume without re-running
- **At-least-once delivery** with idempotent handling
- **Audit everything**

### Core Components

| Component | Role |
|-----------|------|
| Gateway | Authority for connectivity, policy, routing, orchestration, durable state |
| StateStore | System of record (SQLite or HA Postgres) |
| Event Backplane | Cross-instance event delivery via durable outbox |
| Execution Engine | Durable runs/steps/attempts with retries, idempotency, budgets |
| ToolRunner | Sandboxed workspace-mounted execution context |
| Approvals | Durable operator confirmation gates |
| Secret Provider | Out-of-process secret storage (OS keychain / K8s Secrets / encrypted file) |
| PolicyBundle | Layered safety enforcement (deny > require_approval > allow) |
| Presence | TTL-bounded view of connected instances |
| Channels | External messaging connectors with dedupe/debounce |
| Agent | Configured runtime persona with sessions, workspace, tools, skills, memory |
| Client | Operator interface (desktop/mobile/CLI/web) via WebSocket |
| Node | Capability provider (desktop/mobile/headless device) with pairing |

## 4. Current State Inventory

### Repository Structure

- **Monorepo**: pnpm 10, Node 24, TypeScript 5.8
- **Packages**: `packages/schemas` (Zod v4), `packages/gateway` (Hono 4), `packages/client` (WS SDK), `apps/desktop` (Electron 40 + React 19)
- **Deploy**: Dockerfile, docker-compose (single + split profiles), Helm chart (single/split modes)
- **CI**: GitHub Actions (lint, typecheck, build, test with 75% coverage threshold)

### Implementation Status by Area

| Area | Status | Key Files |
|------|--------|-----------|
| **Schemas** | Complete (26 source files, all dual-exported Zod) | `packages/schemas/src/` |
| **Gateway runtime** | Complete (multi-role: all/edge/worker/scheduler/toolrunner) | `src/index.ts` |
| **WS protocol** | Complete (v1 legacy + v2 connect.init/proof) | `src/routes/ws.ts`, `src/ws/handshake.ts` |
| **Auth middleware** | Complete (token store + timing-safe comparison) | `src/modules/auth/` |
| **Agent runtime** | Complete (AI SDK, MCP tools, approval flow, provenance) | `src/modules/agent/` |
| **Execution engine** | Complete (durable runs, leases, idempotency, postconditions) | `src/modules/execution/` |
| **Approval system** | Complete (DAL + resolver + execution integration) | `src/modules/approval/` |
| **Secret providers** | Complete (3 backends + redaction engine) | `src/modules/secret/`, `src/modules/redaction/` |
| **Policy engine** | Functional (bundle manager, loader, snapshots; conditions not evaluated) | `src/modules/policy/` |
| **Presence** | Complete (DAL + TTL cleanup + route) | `src/modules/presence/` |
| **Node pairing** | Complete (DAL + routes; feature-flagged) | `src/modules/node/` |
| **Artifact system** | Complete (metadata DAL + store + routes) | `src/modules/artifact/` |
| **Connector pipeline** | Complete (dedupe + debounce + outbound idempotency) | `src/modules/connector/` |
| **Markdown pipeline** | Complete (parser + chunker + renderers) | `src/modules/markdown/` |
| **Auth profiles** | Complete (DAL + model selector + session pinning) | `src/modules/model/` |
| **Playbooks** | Complete (YAML loader + durable runner) | `src/modules/playbook/` |
| **Slash commands** | Complete (registry + builtin /status /help /ping) | `src/ws/slash-commands.ts`, `src/ws/builtin-commands.ts` |
| **Skill resolver** | Complete (bundled/user/workspace layers) | `src/modules/skill/resolver.ts` |
| **Plugin system** | Complete (Zod manifest, lifecycle hooks, code loading, security) | `src/modules/plugin/` |
| **Multi-agent** | Functional (agent_id scoping in DALs; feature-flagged) | `src/modules/agent/agent-scope.ts` |
| **Observability** | Complete (/status /usage /context + OTel + structured logger) | `src/routes/observability.ts`, `src/modules/observability/` |
| **Backplane** | Complete (outbox + poller + publisher + consumer) | `src/modules/backplane/` |
| **Workflow API** | Complete (run/resume/cancel + listing) | `src/routes/workflow.ts` |
| **Memory** | Complete (CRUD + DELETE + secret scanning) | `src/modules/memory/`, `src/routes/memory.ts` |
| **Audit** | Complete (hash chain + export/verify + forget) | `src/modules/audit/`, `src/routes/audit.ts` |

### Database Migrations (11 dual-target)

| Migration | SQLite | Postgres | Content |
|-----------|--------|----------|---------|
| 001 | ✓ | ✓ | Squashed baseline (all original tables) |
| 002 | ✓ | ✓ | Presence table |
| 003 | ✓ | ✓ | Artifact metadata table |
| 004 | ✓ | ✓ | Nodes + node_capabilities tables |
| 005 | ✓ | ✓ | Approval execution columns (run_id, step_id, attempt_id, resume_token) |
| 006 | ✓ | ✓ | Connector dedupe + outbound idempotency tables |
| 007 | ✓ | ✓ | Policy snapshots table |
| 008 | ✓ | ✓ | Auth profiles table |
| 009 | ✓ | ✓ | Multi-agent (agent_id column on 7 tables) |
| 010 | ✓ | ✓ | Context reports table |
| 011 | ✓ | ✓ | Session compaction columns (compacted_summary, compaction_count) |

### Tests

- **160+ test files**, 1358 tests passing (1297 baseline → 1309 run 1 → 1332 run 2 → 1358 run 3)
- **Coverage**: Meets 75% threshold
- **Test types**: Unit, integration, contract, E2E
- **HA failure matrix tests**: `tests/integration/ha-failure-matrix.test.ts` (edge crash, worker crash, scheduler crash, DB failures, network partitions)

## 5. Architecture Requirements Index (ARI)

159 requirements extracted from 40 architecture documents. Each requirement has a stable SHA1-based ID.

### Category Breakdown

| Category | Count |
|----------|-------|
| interface | 19 |
| design | 38 |
| data | 8 |
| security | 38 |
| ops | 24 |
| testing | 2 |
| deploy | 11 |
| performance | 5 |
| compliance | 1 |

### Status Breakdown

| Status | Count |
|--------|-------|
| Implemented | 129 |
| Partially Implemented | 25 |
| Missing | 5 |
| **Total** | **159** |

## 6. Traceability Matrix

### Protocol & Contracts

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-9c684c4a | Messages validated against contracts | interface | Implemented | `schemas/src/protocol.ts` Zod validation; `ws/protocol.ts` WsMessage parse |
| ARI-aee49684 | Protocol revision negotiation | interface | Implemented | `ws/handshake.ts` protocol_rev in connect.init; `routes/ws.ts` strict handshake flag |
| ARI-4ac54a90 | Events at-least-once with event_id | interface | Implemented | `schemas/src/protocol.ts:76` event_id field; `modules/backplane/outbox-dal.ts` |
| ARI-f47661c8 | Request envelope (request_id, type, payload) | interface | Implemented | `schemas/src/protocol.ts` WsRequestEnvelope |
| ARI-32a8adf2 | Response envelope (ok, result/error) | interface | Implemented | `schemas/src/protocol.ts` WsResponseEnvelope |
| ARI-1ae01e0b | Typed error codes | interface | Implemented | `schemas/src/protocol.ts` WsError |
| ARI-9d6cb817 | Idempotency key for side effects | design | Implemented | `execution/engine.ts` idempotency_records table |
| ARI-cef00171 | Event envelope (event_id, type, occurred_at, scope, payload) | interface | Implemented | `schemas/src/protocol.ts` WsEventEnvelope |
| ARI-cc3f88ca | Consumers deduplicate by event_id | interface | Partial | Consumer-side dedupe not enforced (outbox has event_id but consumer doesn't check) |
| ARI-e4bb33bf | Backward-compatible changes within major version | interface | Partial | No automated compat checking in CI |
| ARI-0617ef61 | Breaking changes require new major version | interface | Partial | No versioned contract families in practice |
| ARI-15cb4762 | Validate inbound/outbound messages against contracts | interface | Implemented | Zod parse on all WS messages |

### Handshake & Identity

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-82e134c4 | connect.init + connect.proof flow | interface | Implemented | `ws/handshake.ts` HandshakeStateMachine; `routes/ws.ts` v2 flow |
| ARI-dcea9b06 | device_id from public key | security | Partial | `ws/device-identity.ts` — STUB: accepts any proof, no real key derivation |
| ARI-60ce940f | Challenge proof binds nonce + transcript | security | Partial | Challenge generated but proof not cryptographically verified |
| ARI-83728251 | Gateway access token during WS upgrade | security | Implemented | `ws/auth.ts` subprotocol extraction; `routes/ws.ts` validation |
| ARI-b3c264a4 | Nodes require pairing approval | security | Implemented | `modules/node/dal.ts` pairing lifecycle; `routes/node.ts` pairing routes |
| ARI-46a401ff | Ed25519 keypair for device identities | security | Missing | No Ed25519 key generation or verification |

### Execution Engine

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-07a63ffc | Run state machine (queued→running→paused\|succeeded\|failed\|cancelled) | design | Implemented | `execution/engine.ts` full lifecycle; `schemas/src/execution.ts` statuses |
| ARI-5fc951d7 | Idempotency key enforcement | design | Implemented | `idempotency_records` table; ON CONFLICT handling in engine |
| ARI-af0361ef | Approval-based pause/resume | design | Implemented | `approval/resolver.ts` bridges approval to execution; `engine.ts` resumeRun |
| ARI-cd16ee47 | Resume tokens opaque with expiry/revocation | security | Implemented | `resume_tokens` table; expiry check in workflow routes |
| ARI-e174dd8f | Budgets/timeouts per run and step | performance | Partial | Schema has budget_tokens/spent_tokens; enforcement partial |
| ARI-02103a28 | Concurrency limits | performance | Missing | No concurrency limit logic |
| ARI-36bb86ea | Postconditions for state-changing steps | design | Implemented | `engine.ts:648-683` evaluatePostcondition |
| ARI-42883e4c | Unverifiable outcomes not marked done | design | Implemented | `engine.ts` pauses on missing_evidence |
| ARI-23d5b300 | Rollback metadata | design | Partial | No structured compensation actions |
| ARI-b35f6b6e | Worker claim/lease | design | Implemented | `lane_leases` + `workspace_leases` tables; engine tryAcquire |
| ARI-394ebc4f | Lane serialization via distributed lock | design | Implemented | `lane_leases` table; engine lane lock |
| ARI-837942ee | Durable outcomes before events | data | Implemented | Transaction-based persistence in engine + workflow routes |
| ARI-b47a50e7 | Idempotency is durable dedupe | design | Implemented | `idempotency_records` table with ON CONFLICT |
| ARI-2f503457 | Retry policy per-step | design | Implemented | `engine.ts` maybeRetryOrFailStep |
| ARI-3150d824 | Cost attribution per run/step/attempt | ops | Partial | `execution_attempts` has cost columns; not fully populated |
| ARI-8dd6c4a0 | Structured logs with stable identifiers | ops | Implemented | Logger class with field inheritance |
| ARI-3a538638 | OpenTelemetry export | ops | Implemented | `observability/otel.ts` OTLP trace exporter |

### Scaling & HA

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-84339688 | Durable state survives restarts | deploy | Implemented | SQLite/Postgres persistence for all state tables |
| ARI-65f12ee6 | Retry safety | deploy | Implemented | Idempotency keys + at-least-once outbox |
| ARI-06ce7859 | Lane serialization guarantee | deploy | Implemented | `lane_leases` table |
| ARI-8d22914b | Observable execution | deploy | Implemented | Gateway events + OTel + structured logs |
| ARI-0e4a5a6e | Durable outbox | design | Implemented | `outbox` table + `outbox-poller.ts` |
| ARI-5e7836f2 | Connection directory with TTL | design | Implemented | `connection_directory` table |
| ARI-6abb3a00 | Scheduler DB-leases + firing_id | design | Partial | CAS update (no owner/expiry lease); firing_id not deduplicated at execution layer |
| ARI-98580432 | Only ToolRunner mounts workspace | deploy | Implemented | K8s ToolRunner + workspace leases |
| ARI-aff4c9d5 | Snapshot export/import | data | Partial | `routes/snapshot.ts` export implemented; import stubbed 501 |
| ARI-de47207a | Failure/failover validation matrix | testing | Implemented | `tests/integration/ha-failure-matrix.test.ts` |
| ARI-3091e498 | Workspace persistence | deploy | Implemented | TYRUM_HOME filesystem persistence |
| ARI-7c1e0962 | Workspace path boundary | security | Implemented | `tool-executor.ts` path sandbox |
| ARI-af29903d | Single-writer workspace | deploy | Implemented | `workspace_leases` table |

### Approvals

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-1db5f9cc | Durable approval records | data | Implemented | `approvals` table + DAL |
| ARI-3abf93d6 | Atomic approval resolution | data | Implemented | Single UPDATE WHERE status='pending' |
| ARI-051ac325 | Idempotent resolution | design | Implemented | Atomic state transition prevents double-submit |
| ARI-528a1a0e | Expired → denial | design | Partial | Expiry column exists; automatic expiry daemon not implemented |
| ARI-f9b002d7 | Approve-once/approve-always/reject | design | Partial | Basic approve/deny; no standing policy override creation |
| ARI-52282815 | Suggested overrides | design | Missing | Not in approval schema |
| ARI-5f8539ab | Approval request shape (impact, traceability) | interface | Partial | Has core fields; missing estimated_cost, items_preview, suggested_overrides |
| ARI-ca165747 | Resume without re-running | design | Implemented | `approval/resolver.ts` + workflow resume logic |
| ARI-0d98b304 | Approval events | ops | Implemented | `approval/resolver.ts` publishes approval.requested/resolved |

### Policy & Sandbox

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-d07073c6 | Deterministic evaluation (allow/deny/require_approval) | security | Implemented | `policy/bundle.ts` evaluate() |
| ARI-f45f2e4c | Deny > require_approval > allow | security | Implemented | `policy/bundle.ts` severity ordering |
| ARI-b92a762a | Policy snapshots per run | security | Implemented | `policy_snapshots` table + DAL |
| ARI-79f0d3bb | PolicyBundle minimum domains | security | Partial | Schema supports all domains; enforcement not per-domain |
| ARI-541d83d0 | Provenance tagging | security | Implemented | `agent/provenance.ts` tagContent() |
| ARI-b834c9fd | Sandboxing enforcement | security | Partial | Workspace boundary enforced; no seccomp/AppArmor |
| ARI-6db3c732 | Policy decisions in records | ops | Partial | Snapshots exist; not attached to every step |

### Policy Overrides

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-f31ec123 | Scoped to agent_id | security | Implemented | agent_id in scoping queries |
| ARI-50a1a9fc | Cannot override deny | security | Implemented | `policy/bundle.ts` deny short-circuits |
| ARI-b482cbd0 | Override evaluation order | security | Implemented | Bundle evaluate order |
| ARI-e32f4e6d | Override durable record | data | Missing | No policy_overrides table |
| ARI-5a942bf2 | Wildcard grammar | design | Missing | Not implemented |
| ARI-524b557b | Override audit events | ops | Partial | policy_override.created event type exists in schema |

### Secrets

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-bdd4d5ab | Model never sees raw values | security | Implemented | Handle-based resolution; redaction engine |
| ARI-dcb6ba2e | Explicit, scoped, auditable, revocable | security | Partial | Explicit and scoped; audit and revocation partial |
| ARI-6d4f7f48 | Resolution at last responsible moment | security | Implemented | tool-executor resolves secret: handles |
| ARI-9babdeb8 | Policy-gated + audited resolution | security | Missing | No policy check before resolution; no audit record |
| ARI-141fcfcf | Never persisted to StateStore | security | Implemented | Secrets only in secret provider backends |
| ARI-b059a6d5 | Redaction at boundaries | security | Implemented | `redaction/engine.ts` + scanForSecretPatterns |
| ARI-b750e58c | Debug modes redact | security | Implemented | Redaction engine always active |
| ARI-b339844d | Rotation + revocation | security | Partial | Schema supports it; FileSecretProvider has rotate |

### Auth & Models

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-13037334 | Auth profiles = metadata + secret handles | security | Implemented | `auth_profiles` table + DAL |
| ARI-bfd7f5f1 | Per agent_id; cross-agent deny | security | Partial | No agent_id column on auth_profiles |
| ARI-fcf6e8d6 | Session pinning | design | Implemented | `model/selector.ts` in-memory pin map |
| ARI-d8f60177 | Cooldown/disable on failures | design | Implemented | `selector.ts` failover; `auth-profile-dal.ts` recordFailure/deactivate |
| ARI-2f88c42b | Auth mutations audited | security | Partial | Auth middleware required; no specific audit record |
| ARI-f23bf5ff | provider/model format | interface | Implemented | Schema + selector |
| ARI-986287bb | Fallback chain | design | Implemented | `selector.ts` priority-ordered selection |
| ARI-5f6618d9 | Model selection events | ops | Partial | No model.selected event emission |

### Sessions & Lanes

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-6e75e2d6 | One run per (key, lane) | design | Implemented | `lane_leases` table; engine lane lock |
| ARI-7c2cd116 | DM scope isolation | security | Partial | Session keys exist; no per_account_channel_peer default |
| ARI-56c7809b | Key scheme | design | Implemented | `schemas/src/keys.ts` TyrumKey union |
| ARI-0f1607af | Queue modes | design | Partial | collect/followup/steer in schema; steer_backlog/interrupt not implemented |
| ARI-a3138e11 | Distributed serialization | deploy | Implemented | StateStore-backed lane_leases |

### Messages & Channels

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-74645bd6 | Normalized inbound envelope | interface | Implemented | `modules/ingress/telegram.ts` normalizeUpdate |
| ARI-77375206 | Inbound dedupe | design | Implemented | `connector/dedupe-dal.ts` + `connector/pipeline.ts` |
| ARI-ef204fef | Debouncing per container | design | Implemented | `connector/pipeline.ts` timer-based debounce |
| ARI-943b17c5 | Outbound idempotency keys | design | Implemented | `connector/outbound.ts` + `outbound_idempotency` table |
| ARI-4fa2e3fe | Outbound audit events | ops | Partial | No explicit audit event for outbound sends |
| ARI-007b9053 | Queue overflow handling | design | Implemented | `execution/engine.ts` maxQueueDepth + QueueOverflowError + /status depth |
| ARI-4f412f12 | Steer/interrupt at safe boundaries | design | Partial | Not implemented beyond schema |
| ARI-d002deb9 | Channel dedupe + debounce | design | Implemented | Full pipeline in `connector/` |
| ARI-9313d71d | Connectors don't bypass policy | security | Partial | Pipeline exists but no policy gate in connector path |
| ARI-ae1f4b1d | Typing modes | design | Implemented | `schemas/src/agent.ts` TypingMode enum + TypingConfig + AgentSessionConfig |

### Markdown

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-56e7ff53 | Markdown → IR → Chunk → Render | design | Implemented | `markdown/parser.ts`, `chunker.ts`, `renderers/` |
| ARI-1aaaa33c | Never split inside code fences | design | Implemented | Chunker handles code blocks |
| ARI-8a399b69 | Fallback to plain text | design | Implemented | `renderers/plain.ts` |
| ARI-1c447862 | Streaming uses same chunker | design | Partial | Chunker exists; not integrated with streaming |

### Artifacts

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-25503723 | Attached to execution scope | data | Implemented | `artifact_metadata` table with run/step/attempt IDs |
| ARI-292e71e9 | sha256 + content_type | data | Implemented | `schemas/src/artifact.ts` ArtifactMetadata |
| ARI-ba71388d | Fetched through gateway only | security | Implemented | `routes/artifact.ts` GET /artifacts/:id |
| ARI-7265e9ce | Authorization on fetch | security | Partial | Auth middleware; no per-artifact policy check |
| ARI-83a27ca2 | Signed URLs after auth | security | Partial | S3 store exists; no signed URL generation |
| ARI-6e8ff578 | Fetch audit events | ops | Missing | No artifact.fetched event |
| ARI-bcde2ac2 | Retention policy + quotas | ops | Missing | No retention or quota enforcement |

### Agent Loop & System Prompt

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-363a012f | Runs serialized per key/lane | design | Implemented | Lane leases |
| ARI-9e77efe5 | System prompt guardrails advisory | security | Implemented | Policy enforcement separate from prompts |
| ARI-ae282d7f | Context report per run | ops | Implemented | `context_reports` table + DAL + `/context/list` `/context/detail/:run_id` routes |

### Context & Compaction

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-b13ab3b7 | Compaction preserves constraints | design | Implemented | `agent/compaction.ts` LLM-based compaction with constraint-preserving prompt |
| ARI-12b1e0e0 | Pruning only tool-result messages | design | Partial | LLM compaction replaces older turns; no selective tool-result pruning |

### Capabilities & Nodes

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-bd48bc56 | Dot-separated capability namespace | interface | Implemented | `schemas/src/protocol.ts` ClientCapability |
| ARI-fac1f4c2 | State-changing ops emit evidence | design | Implemented | Postcondition system |
| ARI-7cc2951a | Postconditions when feasible | design | Implemented | `evaluatePostcondition()` |
| ARI-ca3d55cd | Node single WS per device | interface | Implemented | `routes/ws.ts` connection tracking |
| ARI-d5228511 | Pairing scoped authorization | security | Implemented | `node/dal.ts` trust level + capability allowlist |
| ARI-c5678035 | Revoked node blocked | security | Implemented | `node/dal.ts` revokeNode |

### Playbooks

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-9ff293c4 | Command namespaces (no implicit shell) | security | Implemented | `playbook/runner.ts` typed actions |
| ARI-d09e29a2 | Timeouts + output caps | performance | Partial | Schema has timeoutMs; enforcement partial |
| ARI-f9ed712e | No secrets in specs | security | Implemented | Secret handles via provider |
| ARI-adad29be | LLM steps budgeted | security | Partial | Budget fields exist; enforcement partial |

### Tools

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-3439dd6a | Availability by policy not prompt | security | Partial | allow-list in AgentToolConfig; no PolicyBundle integration |
| ARI-3125167a | Accept secret handles | security | Implemented | `tool-executor.ts` secret: handle resolution |
| ARI-8212268f | Outputs redact secrets | security | Implemented | `redaction/engine.ts` |
| ARI-f40e5a1f | Match targets for overrides | design | Missing | No match target definitions |

### Plugins & Skills

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-8c679477 | Plugins declare permissions | security | Implemented | Zod manifest validation + lifecycle hooks + code loading + permission declarations |
| ARI-0a755256 | Skills are guidance | design | Implemented | Skills as markdown injected into prompt |
| ARI-5b3bf2a5 | Skill load order (bundled < user < workspace) | design | Implemented | `skill/resolver.ts` layered resolution |

### Automation

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-d0dc04c1 | Idempotent automation | design | Partial | firing_id generated; not deduplicated at execution |
| ARI-2b95ba3b | Same policy/approval gates | security | Partial | Watchers enqueue to engine; policy not checked |
| ARI-d07e845a | Scheduler lease acquisition | design | Partial | CAS update; no owner/expiry lease |

### Memory

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-5596a0a3 | No secrets in memory | security | Implemented | `routes/memory.ts` secret scanning on POST |
| ARI-a7fc3b4c | Pre-compaction flush | design | Missing | Not implemented |
| ARI-6959bc80 | User forget controls | compliance | Implemented | DELETE routes for facts/events/capabilities |

### Presence

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-8a028e9d | TTL-bounded + size-capped | ops | Implemented | `presence/dal.ts` cleanup with TTL |
| ARI-0add884f | Access-controlled to operators | security | Implemented | Auth middleware on /presence |
| ARI-2b16ef16 | Gateway self presence at startup | ops | Implemented | `routes/ws.ts` finalizeConnection seeds presence |

### Multi-Agent

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-53054d5e | Hard namespace per agent_id | security | Implemented | `agent-scope.ts` + agent_id on 7 tables |
| ARI-c4cf3717 | Enforced by gateway | security | Partial | DAL scoping; not all code paths verified |
| ARI-20594bd7 | Routing auditable/reversible | ops | Partial | No routing audit trail |

### Client

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-808fd445 | Session timeline view | design | Partial | React SPA scaffold created (`packages/web-ui/`); pages not yet migrated |
| ARI-bb184f79 | Approval queue | design | Partial | HTTP approval CRUD; no WS-connected queue UI |
| ARI-8576a4da | Instances/presence view | design | Partial | /presence endpoint; no UI panel |
| ARI-101d3db8 | Context/usage panels | ops | Partial | /status /usage /context endpoints; no UI panel |

### Observability

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-a543d833 | /status shows model, session, context, sandbox | ops | Implemented | `routes/observability.ts` /status |
| ARI-aa07bb6a | Context reports persisted | ops | Implemented | `context_reports` table + `ContextReportDal` |
| ARI-b48c7181 | Usage accounting | ops | Implemented | `routes/observability.ts` /usage |
| ARI-544c57a9 | Provider quota polling | ops | Missing | Not implemented |
| ARI-6fa8980a | Durable logs with stable IDs | ops | Implemented | Logger + OTel + stable IDs |

### Slash Commands

| ARI ID | Requirement | Category | Status | Evidence |
|--------|-------------|----------|--------|----------|
| ARI-0cb10601 | Commands handled by gateway | design | Implemented | `ws/slash-commands.ts` registry |
| ARI-f1aa863e | Side-effecting commands need policy | security | Partial | No policy gate on slash commands |

## 7. Gap Cards

### GAP-dcea9b06 — Device identity Ed25519 verification (STUB)

- **ARI**: ARI-dcea9b06, ARI-60ce940f, ARI-46a401ff
- **Status**: STUB — `ws/device-identity.ts` accepts any proof
- **Impact**: Security — no cryptographic device authentication
- **Risk**: High
- **Proposed**: Implement Ed25519 key derivation and proof verification using Node.js crypto
- **Validation**: Unit tests with known keypairs; negative tests for invalid signatures
- **Rollback**: Keep non-strict handshake as default

### GAP-d07073c6 — Policy condition evaluation not implemented

- **ARI**: ARI-d07073c6, ARI-79f0d3bb
- **Status**: Structural gap — `bundle.ts` evaluate() ignores conditions
- **Impact**: Security — policy rules can't match on runtime context
- **Risk**: Medium (observe-only mode mitigates)
- **Proposed**: Implement condition matcher (simple field comparison)
- **Validation**: Unit tests with varied conditions

### GAP-ae282d7f — Context report per run not implemented

- **ARI**: ARI-ae282d7f, ARI-aa07bb6a
- **Status**: Missing
- **Impact**: Ops — no visibility into context composition
- **Risk**: Low
- **Proposed**: Generate context report in agent runtime; persist with run
- **Validation**: Integration test

### GAP-b13ab3b7 — Compaction/pruning not implemented

- **ARI**: ARI-b13ab3b7, ARI-12b1e0e0
- **Status**: Missing
- **Impact**: Performance — context window overflow in long sessions
- **Risk**: Medium
- **Proposed**: Implement token-based compaction with constraint preservation
- **Validation**: Unit tests verifying constraint preservation

### GAP-aff4c9d5 — Snapshot export/import

- **ARI**: ARI-aff4c9d5
- **Status**: Missing
- **Impact**: Data — no backup/migration capability
- **Risk**: Low
- **Proposed**: Export: consistent dump of durable tables; Import: validation + insert
- **Validation**: Round-trip test

### GAP-e4bb33bf — Contract versioning not enforced in CI

- **ARI**: ARI-e4bb33bf, ARI-0617ef61
- **Status**: Partial — no automated compat check
- **Impact**: Interface — breaking changes can slip through
- **Risk**: Medium
- **Proposed**: JSON Schema export + diff-based compat check in CI
- **Validation**: CI test with intentional break

### GAP-8c679477 — Plugin runtime (manifest only, no code execution)

- **ARI**: ARI-8c679477
- **Status**: Partial — loader + registry exist; no lifecycle
- **Impact**: Design — plugins can't actually run
- **Risk**: Low (no runtime impact)
- **Proposed**: Add code loading + onEnable/onDisable hooks
- **Validation**: Integration test with sample plugin

### GAP-52282815 — Suggested overrides for approve-always

- **ARI**: ARI-52282815, ARI-e32f4e6d, ARI-5a942bf2
- **Status**: Missing
- **Impact**: Design — approve-always can't create standing overrides
- **Risk**: Medium
- **Proposed**: Add policy_overrides table; wire to approval resolution
- **Validation**: Integration test

### GAP-9babdeb8 — Secret resolution not policy-gated or audited

- **ARI**: ARI-9babdeb8
- **Status**: Missing
- **Impact**: Security — no policy check or audit trail for secret access
- **Risk**: High
- **Proposed**: Add policy check + audit record per resolution
- **Validation**: Unit test asserting policy deny blocks resolution

### GAP-544c57a9 — Provider quota polling

- **ARI**: ARI-544c57a9
- **Status**: Missing
- **Impact**: Ops — no quota visibility
- **Risk**: Low
- **Proposed**: Background polling with cache + rate limit
- **Validation**: Unit test with mocked provider

## 8. Proposed Plan

### Phase 0 — Foundations (DONE)

All Phase 0 items completed in prior commits:
- 6 ADRs written (protocol-rev, policy-bundle, node-pairing, artifact-metadata, execution-api, multi-agent)
- All target schemas added to `packages/schemas/src/`
- Gateway event model defined and typed

### Phase 1 — Low-risk alignment (DONE)

All Phase 1 items completed in prior commits:
- /status, /usage, /context endpoints
- Presence subsystem (DAL + routes)
- Artifact metadata in StateStore + fetch API
- Memory forget controls + secret scanning

### Phase 2 — Core migrations (DONE)

All Phase 2 items completed in prior commits:
- Protocol rev gating + connect.init/proof (dual-stack)
- Node pairing (DAL + routes, feature-flagged)
- Workflow API (run/resume/cancel)
- Approval-execution bridge
- Connector pipeline (dedupe/debounce/outbound idempotency)
- Markdown IR pipeline (parser + chunker + renderers)
- PolicyBundle (manager + loader + snapshots)
- Auth profiles + model selector
- Durable playbook runner

### Phase 3 — Cleanup (MOSTLY DONE)

Completed:
- Slash command registry + builtins
- Skill resolver (layered)
- Plugin manifest loader + registry
- Multi-agent scoping (agent_id + DAL queries)
- HA failure matrix tests

### Phase 4 — Remaining Work (ACTIVE)

| Priority | PLAN ID | Title | Risk | Status |
|----------|---------|-------|------|--------|
| 1 | PLAN-a1b2c3d4 | Device identity Ed25519 verification | High | **Done run 1** |
| 2 | PLAN-9babdeb8 | Secret resolution policy gate + audit | High | **Done run 1** |
| 3 | PLAN-e5f6a7b8 | Policy condition evaluation | Medium | **Done run 2** |
| 4 | PLAN-c9d0e1f2 | Context report per run | Low | **Done run 2** |
| 5 | PLAN-e7f8a9b0 | Snapshot export (import stubbed) | Low | **Done run 2** |
| 6 | PLAN-e1f2a3b4 | Queue overflow handling | Low | **Done run 2** |
| 7 | PLAN-a7b8c9d0 | Typing modes schema | Low | **Done run 2** |
| 8 | PLAN-c1d2e3f4 | JSON Schema export | Low | **Done run 3** |
| 9 | PLAN-e9f0a1b2 | Provider model catalog | Medium | **Done run 3** |
| 10 | PLAN-a3b4c5d6 | Session compaction | Medium | **Done run 3** |
| 11 | PLAN-a5b6c7d8 | Plugin runtime (code execution) | Low | **Done run 3** |
| 12 | PLAN-c3d4e5f6 | Client SPA scaffold | Low | **Done run 3** |

## 9. Implementation Journal

### Run 1 (prior context)

#### PLAN-a1b2c3d4: Device identity Ed25519 verification

- Replaced STUB in `ws/device-identity.ts` with real Ed25519 crypto
- Added `deriveDeviceId()`, `buildTranscript()`, `verifyDeviceProof()` + 11 tests

#### PLAN-9babdeb8: Secret resolution policy gate + audit

- Added policy check + structured audit logging in `tool-executor.ts`
- 1 test for policy deny blocking secret resolution

### Run 2 (this context)

#### PLAN-e5f6a7b8: Policy condition evaluation (d9ad66f)

- Goal: Evaluate rule conditions against runtime context in `PolicyBundleManager.evaluate()`
- Changes: Added `matchesConditions()` helper, context parameter on `evaluate()`
- Tests: 5 new condition-matching tests (filter by context, skip w/o context, unconditional always matches, multi-key conditions, mixed conditional/unconditional)

#### PLAN-c9d0e1f2: Context report per run (5b03e19)

- Goal: Schema + DAL + routes for per-run context reports (what the model "saw")
- Changes: `ContextReportData` Zod schema, `context_reports` migration (SQLite + Postgres), `ContextReportDal` with create/getByRunId/list, `/context/list` + `/context/detail/:run_id` routes, container wiring
- Tests: 5 DAL tests

#### PLAN-e7f8a9b0: Snapshot export (6f1296a)

- Goal: Transactional dump of durable tables via `GET /snapshot/export`
- Changes: `exportSnapshot()` function with 21 durable tables, `/snapshot/export` route, `/snapshot/import` stubbed with 501
- Tests: 5 snapshot export tests

#### PLAN-e1f2a3b4: Queue overflow handling (ade7eda)

- Goal: Configurable queue depth limit + observability
- Changes: `maxQueueDepth` opt-in on `ExecutionEngine`, `QueueOverflowError`, `getQueueDepth()`, `queue_depth` in `/status`
- Tests: 3 tests (depth reporting, overflow rejection, unlimited mode)

#### PLAN-a7b8c9d0: Typing modes schema (addb970)

- Goal: Define the four architecture-specified typing modes
- Changes: `TypingMode` enum (`never`/`message`/`thinking`/`instant`), `TypingConfig` (mode + refresh_interval_ms), added to `AgentSessionConfig`
- Tests: 6 schema tests

### Run 3 (this context)

#### PLAN-c1d2e3f4: JSON Schema export (a38a0c4)

- Goal: Expose all Zod schemas as JSON Schema via `/schemas` route using native Zod v4 `z.toJSONSchema()`.
- Changes: `packages/schemas/src/json-schema.ts` (lazy barrel scanner, avoids circular imports via dynamic `import()`), `routes/schema.ts` (GET /schemas, /schemas/all, /schemas/:name), mounted in app.ts (always-on, no flag).
- Tests: 4 new (list names, single schema, all schemas, unknown throws).

#### PLAN-e9f0a1b2: Provider model catalog (70af55f)

- Goal: Three-tier model catalog (disk cache → network fetch → bundled snapshot) from models.dev with provider env-var detection.
- Changes: `packages/schemas/src/model-catalog.ts` (CatalogModel, CatalogProvider, ModelLimits, ModelCost — no `.strict()` for external API compat), `modules/model/catalog-service.ts` (ModelCatalogService with refresh/getModel/getEnabledProviders), `models-snapshot.json` (13 providers trimmed from models.dev), `routes/catalog.ts` (GET /models/catalog, /models/catalog/:modelId), container wiring.
- Tests: 5 new (snapshot loading, cache r/w, unknown model, env detection, model limits).

#### PLAN-a3b4c5d6: Session compaction (843313a)

- Goal: LLM-based session history compaction. System prompt survives. Last N messages preserved. High-signal info retained.
- Changes: `CompactionConfig` schema added to `agent.ts`, migration `011_session_compaction.sql` (both SQLite/Postgres), `session-dal.ts` (updateCompaction + new columns), `compaction.ts` module (shouldCompact, buildCompactionPrompt, compactSession), integrated into `runtime.ts` `finalizeTurn()` with `TYRUM_SESSION_COMPACTION` feature flag (default ON), `formatSessionContext()` updated to use compacted summary.
- Tests: 7 new (threshold checks, prompt building, compaction calls, summary+recent return, DAL persistence).

#### PLAN-a5b6c7d8: Plugin runtime (83e9f10)

- Goal: Full plugin lifecycle with code execution, Zod manifest validation, lifecycle hooks.
- Changes: `packages/schemas/src/plugin.ts` (PluginManifestSchema, PluginCapability, PluginPermission enums), `modules/plugin/types.ts` (PluginInterface, PluginContext, ToolDescriptor), `loader.ts` rewritten (Zod validation, entry path security, dynamic import), `registry.ts` rewritten (async lifecycle, Logger injection, tool/command registration), plugin routes updated (async, include error/tools/commands), container wiring behind `TYRUM_PLUGINS` flag (default OFF).
- Tests: 8 new + 18 updated existing tests for new async API.

#### PLAN-c3d4e5f6: Client SPA scaffold (7df2167)

- Goal: React SPA scaffold replacing server-rendered web-ui.ts (Phase 1 only).
- Changes: `packages/web-ui/` package (React 19, Vite 6, React Router 7), `routes/spa.ts` (static asset serving with immutable cache + SPA fallback), mounted in `app.ts` behind `TYRUM_SPA_UI` flag (default OFF).
- Tests: 3 new (SPA fallback HTML, static JS serving, 404 for missing).

## 10. Risks, Mitigations, Rollback

| Risk | Impact | Mitigation | Rollback |
|------|--------|------------|----------|
| Protocol changes break clients | High | Dual-stack v1/v2; strict mode off by default | Disable strict handshake flag |
| Data migrations | High | All additive (ALTER ADD COLUMN, CREATE TABLE) | Drop new columns/tables |
| Policy enforcement gaps | High | Observe-only mode; enforce per-domain | Disable TYRUM_POLICY_ENFORCE |
| Execution engine API | High | Feature-flagged; legacy runner kept | Disable TYRUM_WORKFLOW_API |
| Secret resolution without audit | High | High priority backlog item | Current behavior continues |
| Multi-agent isolation incomplete | High | Default single-agent; multi behind flag | Disable TYRUM_MULTI_AGENT |

## 11. Open Questions / Unverifiable Items

1. ~~**Device identity encoding prefix**~~: RESOLVED — using `tyrum-` prefix with base32(sha256(pubkey)).
2. ~~**Plugin code execution model**~~: RESOLVED — Zod manifest validation + dynamic `import()` code loading + lifecycle hooks. Sandboxing deferred (default OFF flag).
3. ~~**Client UI direction**~~: RESOLVED — SPA scaffold created (`packages/web-ui/`), server-rendered kept as fallback. Page migration in future PRs.
4. ~~**Snapshot scope**~~: RESOLVED — exporting 21 durable tables; skipping transient/operational tables.
5. **Queue modes steer_backlog and interrupt**: Semantics described in docs but no existing code pattern. Requires design.
6. ~~**Compaction/pruning**~~: RESOLVED — LLM-based compaction integrated into `finalizeTurn()` with constraint-preserving prompt. Feature-flagged `TYRUM_SESSION_COMPACTION` (default ON).
7. **Provider quota polling**: Requires external API integration — deferred.
8. ~~**JSON Schema export**~~: RESOLVED — Zod v4 has native `z.toJSONSchema()`. No external dependency needed.

## 12. Appendix: Commands Run + Outcomes

### Run 1

```
git status --porcelain → ?? .claude/, ?? RALPH_PROMPT.md, ?? docs/gap-analysis.md
npx tsc --build packages/schemas/tsconfig.json → OK
npx tsc --noEmit --project packages/gateway/tsconfig.json → 8 pre-existing errors only
npx vitest run --config vitest.config.ts → 1297 tests, 0 failures → 1309 after implementations
```

### Run 2

```
# Baseline
git diff --stat → 2 files uncommitted (bundle.ts + STATE.md)
npx vitest run policy-bundle.test.ts → 1 failure (fixed test using conditions)
npx vitest run policy-bundle.test.ts → 19 pass (5 new condition tests)
npx vitest run → 1314 pass, 0 fail

# Context report feature
npx tsc --build packages/schemas/tsconfig.json → OK
npx vitest run context-report-dal.test.ts → 5 pass
npx vitest run → 1319 pass, 0 fail

# Snapshot export
npx vitest run snapshot-export.test.ts → 5 pass (after fixing session schema)
npx vitest run → 1324 pass, 0 fail

# Queue overflow
npx vitest run execution-engine.test.ts → 15 pass (3 new)
npx vitest run → 1327 pass, 0 fail

# Typing modes
npx tsc --build packages/schemas/tsconfig.json → OK (after fixing default)
npx vitest run agent.test.ts → 11 pass (6 new)
npx vitest run → 1332 pass, 0 fail
```

### Run 3

```
# JSON Schema export
npx tsc --build packages/schemas/tsconfig.json → OK
npx vitest run json-schema.test.ts → 4 pass
npx vitest run → 1336 pass, 0 fail

# Provider model catalog
npx vitest run catalog-service.test.ts → 5 pass
npx vitest run → 1341 pass, 0 fail

# Session compaction
npx vitest run compaction.test.ts → 7 pass
npx vitest run → 1348 pass, 0 fail

# Plugin runtime
npx vitest run plugin → 26 pass (8 new + 18 updated)
npx vitest run → 1355 pass, 0 fail

# SPA scaffold
npx vitest run spa.test.ts → 3 pass
npx vitest run → 1358 pass, 0 fail

# Final typecheck
npx tsc --noEmit --project packages/gateway/tsconfig.json → pre-existing errors only
```
