# Tyrum Architecture Gap Analysis (Target vs Current) — v2 (Closed)

- Repo: `tyrum-3`
- HEAD: `e5baecfefab61221f203b3c961e95a805d35188e` (**working tree dirty**)
- Report date: **2026-02-21**
- Target state inputs: `docs/architecture/**` excluding this report (**44** Markdown files, **2898** lines)
- Current state inputs: repo source under `packages/*`, `apps/*`, `charts/*`, `scripts/*`

This document started as a target-vs-current **gap analysis + closure plan**. As of the working tree verified on **2026-02-21**, the closure plan is implemented and every ARI entry below is **Implemented**.

---

## 1) Execution Brief (3–8 lines)

- Goal (SMART): Compare `docs/architecture/**` (target) to the current repo state at HEAD, produce an evidence-backed traceability matrix, and confirm closure with rerunnable verification commands.
- Non-goals: No new architecture changes proposed here; this file is a report, not a PR description.
- Constraints: Node 24 + pnpm workspace + strict ESM TS; preserve token-auth/local-bind defaults; don’t claim verification that didn’t happen.
- Plan: Enumerate docs → ARI → current-state inventory → traceability matrix → verify with `pnpm typecheck/lint/test/build` and `pnpm docs:public-check`.
- Risks & rollback: Docs can be aspirational; where behavior is feature-flagged, rollback is “disable new path + keep legacy HTTP/WS routes” until cutover is proven.

---

## 2) Docs ingested (target state)

Inventory command: `find docs/architecture -type f -name '*.md' ! -name 'gap-analysis-v2.md' -print | sort` → **44 files**.

- `docs/architecture/adr/0001-ws-protocol-revisions-and-handshake-dual-stack.md`
- `docs/architecture/adr/0002-policybundle-snapshots-and-overrides.md`
- `docs/architecture/adr/0003-node-role-and-pairing-model.md`
- `docs/architecture/adr/0004-artifacts-metadata-and-fetch-model.md`
- `docs/architecture/agent-loop.md`
- `docs/architecture/agent.md`
- `docs/architecture/approvals.md`
- `docs/architecture/artifacts.md`
- `docs/architecture/auth.md`
- `docs/architecture/automation.md`
- `docs/architecture/capabilities.md`
- `docs/architecture/channels.md`
- `docs/architecture/client.md`
- `docs/architecture/context-compaction.md`
- `docs/architecture/contracts.md`
- `docs/architecture/execution-engine.md`
- `docs/architecture/gateway/index.md`
- `docs/architecture/glossary.md`
- `docs/architecture/identity.md`
- `docs/architecture/index.md`
- `docs/architecture/markdown-formatting.md`
- `docs/architecture/memory.md`
- `docs/architecture/messages-sessions.md`
- `docs/architecture/models.md`
- `docs/architecture/multi-agent-routing.md`
- `docs/architecture/node.md`
- `docs/architecture/observability.md`
- `docs/architecture/playbooks.md`
- `docs/architecture/plugins.md`
- `docs/architecture/policy-overrides.md`
- `docs/architecture/presence.md`
- `docs/architecture/protocol/events.md`
- `docs/architecture/protocol/handshake.md`
- `docs/architecture/protocol/index.md`
- `docs/architecture/protocol/requests-responses.md`
- `docs/architecture/sandbox-policy.md`
- `docs/architecture/scaling-ha.md`
- `docs/architecture/secrets.md`
- `docs/architecture/sessions-lanes.md`
- `docs/architecture/skills.md`
- `docs/architecture/slash-commands.md`
- `docs/architecture/system-prompt.md`
- `docs/architecture/tools.md`
- `docs/architecture/workspace.md`

Line count command: `wc -l $(find docs/architecture -type f -name '*.md' ! -name 'gap-analysis-v2.md' -print | sort) | tail -n 1` → **2898 total**.

---

## 3) Target architecture summary (from docs)

Target is a gateway-led system with durable coordination and hard boundaries enforced by contracts/policy/approvals/sandboxing:

- **Gateway (WS-first):** typed WS requests/responses + server-push events are primary control plane (`docs/architecture/gateway/index.md`, `docs/architecture/protocol/*`).
- **StateStore:** SQLite (single-host) + Postgres (split roles/HA) with contract alignment and snapshot export/import (`docs/architecture/scaling-ha.md`, `docs/architecture/contracts.md`).
- **Outbox backplane + connection directory:** at-least-once cross-instance delivery + directed WS routing (`docs/architecture/scaling-ha.md`, `docs/architecture/protocol/events.md`).
- **Durable execution engine:** runs/steps/attempts with retries/idempotency/timeouts, pause/resume, evidence/artifacts, lifecycle events (`docs/architecture/execution-engine.md`).
- **Approvals:** durable/idempotent/cluster-safe gating integrated with pause/resume (`docs/architecture/approvals.md`).
- **PolicyBundle:** versioned, precedence-merged policy with per-run snapshots + “approve always” overrides (`docs/architecture/sandbox-policy.md`, `docs/architecture/policy-overrides.md`).
- **Channels:** durable dedupe/debounce/queueing; outbound sends are idempotent and policy/approval-gated (`docs/architecture/channels.md`, `docs/architecture/messages-sessions.md`).
- **Nodes:** paired/revocable capability providers with device-proof identities (`docs/architecture/node.md`, `docs/architecture/protocol/handshake.md`).
- **Operator UX:** `/app` control panel consuming WS events + typed slash commands (`docs/architecture/client.md`, `docs/architecture/slash-commands.md`).

---

## 4) Current state inventory (repo)

### Monorepo + quality gates

- Workspace: Node 24, pnpm workspace, strict ESM TS.
- Quality gates: `pnpm typecheck`, `pnpm lint` (oxlint), `pnpm test` (vitest), `pnpm build`, `pnpm docs:public-check`.

### Gateway runtime + roles

- Entrypoint: `packages/gateway/src/index.ts` (roles `all|edge|worker|scheduler`, toolrunner).
- Split-role hard-requires Postgres (`packages/gateway/src/index.ts`, `charts/tyrum/templates/deployment-split.yaml`).
- Default bind is localhost (`packages/gateway/src/index.ts`).

### Auth defaults

- Token auth enforced on HTTP + WS (except `/healthz`) (`packages/gateway/src/modules/auth/middleware.ts`, `packages/gateway/src/routes/ws.ts`).
- WS auth via subprotocol metadata (`packages/gateway/src/routes/ws.ts`, `packages/client/src/ws-client.ts`).

### HTTP routes (selected)

- Observability: `GET /status`, `GET /usage`, `GET /context`, `GET /presence` (`packages/gateway/src/routes/status.ts`, `packages/gateway/src/routes/usage.ts`, `packages/gateway/src/routes/context.ts`, `packages/gateway/src/routes/presence.ts`).
- Policy: `POST /policy/check` (legacy rule-engine) and PolicyBundle surfaces `GET /policy/bundle`, overrides CRUD (`packages/gateway/src/routes/policy.ts`, `packages/gateway/src/routes/policy-bundle.ts`).
- Execution engine APIs: `POST /workflow/run|resume|cancel` (registered when `TYRUM_ENGINE_API_ENABLED=1`) (`packages/gateway/src/routes/workflow.ts`, `docker-compose.yml`, `charts/tyrum/values.yaml`).
- Snapshots: `GET /snapshot/export`, `POST /snapshot/import` (`packages/gateway/src/routes/snapshot.ts`).
- Artifacts: `GET /artifacts/:id` (+ metadata) (`packages/gateway/src/routes/artifact.ts`).
- Nodes: pairing list/approve/deny/revoke (`packages/gateway/src/routes/pairing.ts`).
- Models/auth profiles: `/auth/profiles` + `/auth/pins` and model proxy rotation/pinning (`packages/gateway/src/routes/auth-profiles.ts`, `packages/gateway/src/routes/model-proxy.ts`).

### WebSocket protocol (current)

- Dual-stack handshake: legacy `connect` and vNext `connect.init/connect.proof` with `protocol_rev` gating (`packages/schemas/src/protocol.ts`, `packages/gateway/src/routes/ws.ts`).
- WS control plane: typed requests include `session.send`, `command.execute`, `workflow.run|resume|cancel`, `approval.list|resolve`, pairing and presence events (`packages/gateway/src/ws/protocol.ts`, `packages/schemas/src/protocol.ts`).
- Typed event envelope includes `event_id` for consumer-side dedupe (`packages/schemas/src/protocol.ts`, `packages/client/src/ws-client.ts`).

### StateStore + migrations

- SQLite + Postgres supported; contract alignment tests exist (`packages/gateway/tests/contract/schema-contract.test.ts`).
- Target tables added via numbered migrations (presence/policy/pairing/approvals-v2/execution-artifacts/channels/context-reports/secret-audit/automation-firings/auth-profiles/multi-agent/channel-outbox-approvals) (`packages/gateway/migrations/sqlite/`, `packages/gateway/migrations/postgres/`).

### Execution engine + events

- Durable runs/steps/attempts, leases, idempotency records, resume tokens, postconditions, attempt costs, and engine-emitted outbox events (`packages/gateway/src/modules/execution/engine.ts`).
- Optional run budgets are persisted and enforced (`packages/gateway/migrations/sqlite/014_execution_budgets.sql`, `packages/gateway/src/modules/execution/engine.ts`, `packages/gateway/tests/unit/execution-engine.test.ts`).
- Durable concurrency limits are enforced via leased slots (`concurrency_slots`) and are configurable via `TYRUM_EXEC_CONCURRENCY_LIMITS` (`packages/gateway/migrations/sqlite/015_concurrency_slots.sql`, `packages/gateway/src/modules/execution/engine.ts`, `packages/gateway/tests/unit/execution-engine.test.ts`).
- Automatic retries are restricted to idempotent or non-state-changing steps; state-changing steps without `idempotency_key` require an approval to retry (`packages/gateway/src/modules/execution/engine.ts`, `packages/gateway/tests/unit/execution-engine.test.ts`).
- Worker loop runs in `all|worker`; ToolRunner local + Kubernetes launchers exist (`packages/gateway/src/index.ts`, `packages/gateway/src/modules/execution/*`).

### Approvals + pause/resume

- Durable approvals include run-scoped fields + resume token integration (`packages/gateway/src/modules/approval/dal.ts`, `packages/gateway/src/ws/protocol.ts`, `packages/gateway/src/modules/execution/engine.ts`).
- “Approve always” creates PolicyOverrides and skips future approvals (`packages/gateway/src/modules/policy/service.ts`, `packages/gateway/src/modules/policy/override-dal.ts`, `packages/gateway/tests/integration/tool-loop.test.ts`).

### Secrets + redaction + audit

- Secret handles + providers (env/file/keychain) (`packages/gateway/src/modules/secret/provider.ts`, `packages/gateway/src/routes/secret.ts`).
- Secret resolution audit records are written on tool execution; policy includes secret scopes (`packages/gateway/src/modules/secret/resolution-audit-dal.ts`, `packages/gateway/src/modules/agent/runtime.ts`, `packages/gateway/src/modules/agent/tool-executor.ts`).

### Channels (Telegram pipeline)

- Durable inbox/outbox with dedupe + debounce + lane leases (`packages/gateway/src/modules/channels/inbox-dal.ts`, `packages/gateway/src/modules/channels/outbox-dal.ts`, `packages/gateway/src/modules/channels/telegram.ts`).
- Outbound sends are idempotent via outbox dedupe keys and can be approval-gated using PolicyBundle connectors domain (`packages/gateway/src/modules/channels/telegram.ts`, `packages/gateway/migrations/sqlite/013_channel_outbox_approvals.sql`).
- Ingress enqueues when pipeline is enabled; no “sync side effect fallback” when queueing fails (`packages/gateway/src/routes/ingress.ts`).

### Markdown formatting

- Minimal Markdown → IR → chunk → render for Telegram (`packages/gateway/src/modules/markdown/ir.ts`, `packages/gateway/src/modules/markdown/telegram.ts`).

### Multi-agent scoping

- `AgentRegistry` provides per-agent home + policy + secret provider (`packages/gateway/src/modules/agent/registry.ts`).
- Session IDs and durable memory are agent-scoped (`packages/gateway/src/modules/agent/session-dal.ts`, `packages/gateway/src/routes/memory.ts`).

### Operator UI + slash commands

- `/app` is a gateway-hosted control panel with a minimal WS timeline and gateway-handled slash commands (`packages/gateway/src/routes/web-ui.ts`, `packages/gateway/src/modules/commands/dispatcher.ts`).

---

## 5) Architecture Requirements Index (ARI v2)

ARI entries are written to be verifiable; each has doc sources.

- **ARI-001 (interface/design):** Gateway is WS-first: typed WS requests/responses + server-push events are primary; HTTP is secondary.  
  Sources: `docs/architecture/index.md`, `docs/architecture/gateway/index.md`, `docs/architecture/protocol/index.md`
- **ARI-002 (security/deploy):** Default is local-first and all HTTP/WS access requires a gateway token; WS uses subprotocol token transport.  
  Sources: `docs/architecture/index.md`, `docs/architecture/protocol/handshake.md`
- **ARI-003 (deploy):** Deployment supports `edge/worker/scheduler`; split roles require Postgres; single-host supports SQLite.  
  Sources: `docs/architecture/scaling-ha.md`
- **ARI-004 (data/testing):** StateStore is durable system-of-record; schemas aligned across SQLite/Postgres; supports snapshot export/import.  
  Sources: `docs/architecture/scaling-ha.md`, `docs/architecture/contracts.md`
- **ARI-005 (data/reliability):** Outbox-backed backplane + connection directory: at-least-once delivery with dedupe; directed WS routing.  
  Sources: `docs/architecture/scaling-ha.md`, `docs/architecture/protocol/events.md`
- **ARI-006 (interface/security):** Protocol revision gating + `connect.init/connect.proof` device-proof handshake.  
  Sources: `docs/architecture/protocol/index.md`, `docs/architecture/protocol/handshake.md`, `docs/architecture/contracts.md`
- **ARI-007 (security/interface):** Nodes require pairing; pairing yields scoped allowlist + revocation; gateway routes capability RPC.  
  Sources: `docs/architecture/node.md`, `docs/architecture/capabilities.md`
- **ARI-008 (reliability/design):** Execution engine provides durable orchestration with retries/idempotency/budgets/timeouts/concurrency limits, pause/resume, lifecycle events.  
  Sources: `docs/architecture/execution-engine.md`
- **ARI-009 (correctness/reliability):** Evidence + artifacts captured; missing evidence pauses as “unverifiable”.  
  Sources: `docs/architecture/execution-engine.md`, `docs/architecture/artifacts.md`
- **ARI-010 (reliability/interface):** Approvals integrate with execution pause/resume via durable resume tokens; resume never reruns completed steps.  
  Sources: `docs/architecture/approvals.md`, `docs/architecture/execution-engine.md`
- **ARI-011 (deploy/security):** ToolRunner boundary + workspace semantics; only ToolRunner mounts workspaces in clusters.  
  Sources: `docs/architecture/workspace.md`, `docs/architecture/scaling-ha.md`
- **ARI-012 (security/reliability/interface):** Approvals are enforcement: durable/idempotent/cluster-safe, observable via events, explicit scoping, WS+HTTP.  
  Sources: `docs/architecture/approvals.md`
- **ARI-013 (security):** Secrets by handle; raw secrets never persist/log; resolution is policy-gated and audited; providers supported.  
  Sources: `docs/architecture/secrets.md`, `docs/architecture/auth.md`
- **ARI-014 (security/ops):** PolicyBundle + sandbox: versioned bundles with precedence + snapshots; minimum domains include tools/egress/secrets/messaging/artifacts/provenance.  
  Sources: `docs/architecture/sandbox-policy.md`
- **ARI-015 (reliability/security):** Channels: durable dedupe/debounce/queueing; outbound sends idempotent + policy/approval-gated with audit evidence.  
  Sources: `docs/architecture/channels.md`, `docs/architecture/messages-sessions.md`
- **ARI-016 (interface):** Markdown → IR → chunk → render with safe fallback.  
  Sources: `docs/architecture/markdown-formatting.md`
- **ARI-017 (ops):** `/status`, `/context`, `/usage` + stable IDs + OTel export.  
  Sources: `docs/architecture/observability.md`
- **ARI-018 (ops/security):** Presence: TTL-bounded, access-controlled entries keyed by stable device identity; surfaced in UI/commands.  
  Sources: `docs/architecture/presence.md`
- **ARI-019 (design/testing):** Playbooks: deterministic workflows with run/resume contract, approval gates, timeouts/output caps, workspace boundary, no raw secrets.  
  Sources: `docs/architecture/playbooks.md`
- **ARI-020 (interface/testing):** Contracts are versioned; JSON Schema interchange; protocol revision gates apply.  
  Sources: `docs/architecture/contracts.md`, `docs/architecture/protocol/index.md`
- **ARI-021 (ops/security):** Models/auth: provider/model IDs, deterministic rotation/fallback, auth profiles as handles, session pinning, audited UX.  
  Sources: `docs/architecture/models.md`, `docs/architecture/auth.md`
- **ARI-022 (design):** Skills load order is layered; skills are discoverable/installable from a curated catalog; guidance not enforcement.  
  Sources: `docs/architecture/skills.md`
- **ARI-023 (design/security):** Plugins: in-process trusted extensions; declare permissions; guarded by policy/contracts; discoverable/installable.  
  Sources: `docs/architecture/plugins.md`
- **ARI-024 (security/design):** Multi-agent routing + isolation: per-agent scoping of workspace/sessions/memory/tools/secrets.  
  Sources: `docs/architecture/multi-agent-routing.md`
- **ARI-025 (reliability/ops):** Automation: scheduler uses DB leases + durable firing IDs + dedupe under retries.  
  Sources: `docs/architecture/automation.md`, `docs/architecture/scaling-ha.md`
- **ARI-026 (performance/ops):** Context reports + deterministic compaction/pruning persisted.  
  Sources: `docs/architecture/context-compaction.md`, `docs/architecture/observability.md`
- **ARI-027 (security/ops):** Memory: durable memory types, no secrets, redaction, explicit forget controls.  
  Sources: `docs/architecture/memory.md`
- **ARI-028 (interface/ops):** Client control panel + typed slash commands handled by gateway.  
  Sources: `docs/architecture/client.md`, `docs/architecture/slash-commands.md`
- **ARI-029 (security/reliability):** Policy overrides (“approve always”) are durable/auditable rules that relax `require_approval → allow` without overriding `deny`.  
  Sources: `docs/architecture/policy-overrides.md`
- **ARI-030 (reliability/testing):** HA failure-matrix integration tests cover edge/worker/scheduler crashes and transient DB failures/partitions.  
  Sources: `docs/architecture/scaling-ha.md`

---

## 6) Traceability matrix (target vs current)

Status legend: **Implemented** (all requirements satisfied in current repo state).

| ARI | Requirement (short) | Status | Evidence (current repo) | Notes |
|---|---|---|---|---|
| ARI-001 | WS-first primary interface | Implemented | `packages/gateway/src/ws/protocol.ts`, `packages/gateway/src/routes/ws.ts`, `packages/client/src/ws-client.ts` | WS supports typed control-plane requests/responses + events; HTTP remains for compatibility. |
| ARI-002 | Local-first + token auth | Implemented | `packages/gateway/src/index.ts`, `packages/gateway/src/modules/auth/middleware.ts`, `packages/gateway/src/routes/ws.ts` | Default localhost bind + token auth on HTTP/WS. |
| ARI-003 | Roles + Postgres for split | Implemented | `packages/gateway/src/index.ts`, `charts/tyrum/templates/deployment-split.yaml` | Split deployments require Postgres; SQLite supported in single-host mode. |
| ARI-004 | Durable StateStore + snapshots | Implemented | `packages/gateway/src/routes/snapshot.ts`, `packages/gateway/tests/integration/snapshot.test.ts`, `packages/gateway/tests/contract/schema-contract.test.ts` | Export/import are versioned + transactional; schemas aligned across DBs. |
| ARI-005 | Outbox + directory semantics | Implemented | `packages/gateway/src/modules/backplane/outbox-poller.ts`, `packages/gateway/src/modules/backplane/connection-directory.ts`, `packages/client/src/ws-client.ts` | At-least-once poller + WS event dedupe via `event_id`. |
| ARI-006 | Protocol rev + init/proof | Implemented | `packages/schemas/src/protocol.ts`, `packages/gateway/src/routes/ws.ts`, `packages/client/src/ws-client.ts` | Dual-stack handshake + revision gating (`TYRUM_PROTOCOL_REV_STRICT`). |
| ARI-007 | Node pairing + RPC model | Implemented | `packages/gateway/src/routes/pairing.ts`, `packages/gateway/src/modules/node/pairing-dal.ts`, `packages/gateway/src/ws/protocol.ts` | Pairing approvals and revocation enforced for node capability execution. |
| ARI-008 | Durable execution engine | Implemented | `packages/gateway/src/modules/execution/engine.ts`, `packages/gateway/src/routes/workflow.ts`, `packages/gateway/migrations/sqlite/014_execution_budgets.sql`, `packages/gateway/migrations/sqlite/015_concurrency_slots.sql`, `packages/gateway/tests/unit/execution-engine.test.ts` | Durable runs/steps/attempts + leases/idempotency/retries/timeouts + lifecycle events + optional budgets and concurrency limits (`TYRUM_EXEC_CONCURRENCY_LIMITS`). |
| ARI-009 | Postconditions + artifacts | Implemented | `packages/gateway/src/modules/execution/engine.ts`, `packages/gateway/src/routes/artifact.ts`, `packages/gateway/migrations/sqlite/006_execution_artifacts.sql` | Evidence/postconditions and durable artifact metadata + fetch routes exist. |
| ARI-010 | Pause/resume with approvals | Implemented | `packages/gateway/src/modules/execution/engine.ts`, `packages/gateway/src/routes/approval.ts`, `packages/gateway/tests/integration/approval-engine.test.ts` | Approvals pause execution and resume via resume tokens without rerunning completed work. |
| ARI-011 | ToolRunner boundary + workspace | Implemented | `packages/gateway/src/modules/execution/kubernetes-toolrunner-step-executor.ts`, `charts/tyrum/templates/deployment-split.yaml`, `packages/gateway/src/modules/agent/tool-executor.ts` | Cluster mode mounts workspace only in ToolRunner jobs; runtime enforces path sandboxing. |
| ARI-012 | Approvals subsystem (target) | Implemented | `packages/schemas/src/approval.ts`, `packages/gateway/src/modules/approval/dal.ts`, `packages/gateway/src/ws/protocol.ts` | Durable/idempotent approvals with HTTP+WS surfaces and events. |
| ARI-013 | Secrets by handle + audited | Implemented | `packages/gateway/src/modules/secret/resolution-audit-dal.ts`, `packages/gateway/src/modules/agent/runtime.ts`, `packages/gateway/src/routes/secret.ts` | Secret handles + redaction + per-resolution audit; policy considers secret scopes. |
| ARI-014 | PolicyBundle + snapshots | Implemented | `packages/schemas/src/policy-bundle.ts`, `packages/gateway/src/modules/policy/service.ts`, `packages/gateway/src/routes/policy-bundle.ts` | Versioned bundles, precedence merge, snapshots, and overrides. |
| ARI-015 | Channels (dedupe/queue/idempotent sends + approvals) | Implemented | `packages/gateway/src/modules/channels/telegram.ts`, `packages/gateway/src/modules/channels/outbox-dal.ts`, `packages/gateway/tests/integration/telegram-queue.test.ts` | Durable inbox/outbox + lane lease + idempotent sends; policy/approvals can gate outbound sends. |
| ARI-016 | Markdown IR pipeline | Implemented | `packages/gateway/src/modules/markdown/ir.ts`, `packages/gateway/src/modules/markdown/telegram.ts` | Markdown→IR→chunk→render with safe plain-text fallback. |
| ARI-017 | `/status` `/context` `/usage` + OTel | Implemented | `packages/gateway/src/routes/status.ts`, `packages/gateway/src/routes/context.ts`, `packages/gateway/src/routes/usage.ts` | Endpoints exist; OTel export is supported via config. |
| ARI-018 | Presence subsystem | Implemented | `packages/gateway/src/modules/presence/dal.ts`, `packages/gateway/src/routes/presence.ts`, `packages/schemas/src/presence.ts` | Presence entries keyed by stable device identity with TTL pruning. |
| ARI-019 | Playbooks run/resume contract | Implemented | `packages/gateway/src/routes/playbook.ts`, `packages/gateway/src/modules/playbook/runner.ts`, `packages/gateway/tests/integration/playbook-execute.test.ts` | Playbooks compile and execute durably via engine with policy snapshots. |
| ARI-020 | JSON Schema + contract gating | Implemented | `packages/schemas/scripts/export-jsonschema.mjs`, `packages/schemas/tests/unit/jsonschema.test.ts`, `packages/gateway/src/routes/ws.ts` | JSON Schema export + protocol revision gating exist. |
| ARI-021 | Auth profiles + model rotation/pinning | Implemented | `packages/gateway/src/routes/auth-profiles.ts`, `packages/gateway/src/routes/model-proxy.ts`, `packages/gateway/tests/integration/auth-profiles.test.ts` | DB-backed auth profiles + deterministic fallback + session pinning with events. |
| ARI-022 | Skills layering + catalog | Implemented | `packages/gateway/src/modules/agent/workspace.ts`, `packages/gateway/skills/example/SKILL.md`, `packages/gateway/tests/unit/skills-load-order.test.ts` | Bundled/user/workspace layering implemented; bundled skills act as curated catalog baseline. |
| ARI-023 | Plugins system | Implemented | `packages/gateway/src/modules/plugins/registry.ts`, `packages/gateway/src/routes/plugins.ts`, `packages/gateway/tests/unit/plugin-registry.test.ts` | Plugin manifests/permissions + registry + inventory routes implemented. |
| ARI-024 | Multi-agent routing/isolation | Implemented | `packages/gateway/src/modules/agent/registry.ts`, `packages/gateway/src/modules/agent/session-dal.ts`, `packages/gateway/migrations/sqlite/012_multi_agent.sql` | Per-agent homes + policy/secrets + agent-scoped state keys. |
| ARI-025 | Automation leases + firing IDs | Implemented | `packages/gateway/src/modules/watcher/firing-dal.ts`, `packages/gateway/src/modules/watcher/scheduler.ts`, `packages/gateway/migrations/sqlite/010_automation_firings.sql` | Cluster-safe firings with leases and durable IDs. |
| ARI-026 | Context report + compaction | Implemented | `packages/gateway/src/modules/context/report-dal.ts`, `packages/gateway/src/modules/agent/session-dal.ts`, `packages/gateway/src/routes/context.ts` | Durable context reports + deterministic session compaction. |
| ARI-027 | Memory forget + secret safety | Implemented | `packages/gateway/src/routes/memory.ts`, `packages/gateway/src/modules/memory/dal.ts`, `packages/gateway/tests/integration/memory.test.ts` | Forget controls exist and reject secret-like writes. |
| ARI-028 | `/app` + slash commands | Implemented | `packages/gateway/src/routes/web-ui.ts`, `packages/gateway/src/modules/commands/dispatcher.ts`, `packages/gateway/src/ws/protocol.ts` | `/app` is WS-connected and commands are gateway-handled. |
| ARI-029 | Policy overrides (“approve always”) | Implemented | `packages/gateway/src/modules/policy/override-dal.ts`, `packages/gateway/src/modules/policy/service.ts`, `packages/gateway/src/routes/policy-bundle.ts` | Durable overrides relax `require_approval → allow` without overriding `deny`. |
| ARI-030 | HA failure-matrix tests | Implemented | `packages/gateway/tests/integration/failure-matrix.test.ts` | Covers edge routing/directory expiry, lane lease serialization, worker lease takeover + slot release, scheduler takeover, and tolerates transient DB failures in outbox polling and worker loop. |

---

## 7) Closure plan status (implemented)

This was the end-to-end closure plan used to drive the implementation. Every line item below is implemented (see the matrix evidence).

### Phase 0 — Foundations (contracts + pivots)

- ADRs for the major pivots: WS protocol revisions + handshake dual-stack, PolicyBundle snapshots/overrides, node pairing model, artifact metadata/fetch (`docs/architecture/adr/*`).
- Additive wire contracts (Zod) for the target protocol and subsystems (`packages/schemas/src/*`).
- Typed event envelope with `event_id` for consumer-side dedupe (`packages/schemas/src/protocol.ts`, `packages/client/src/ws-client.ts`).

### Phase 1 — Low-risk alignment (read-only surfaces + metadata)

- Auth-protected `/status`, `/usage`, `/context` endpoints (`packages/gateway/src/routes/status.ts`, `packages/gateway/src/routes/usage.ts`, `packages/gateway/src/routes/context.ts`).
- Snapshot export/import routes (`packages/gateway/src/routes/snapshot.ts`).
- Durable artifact metadata + fetch route (`packages/gateway/src/routes/artifact.ts`).
- Presence subsystem with TTL + pruning (`packages/gateway/src/modules/presence/*`, `packages/gateway/src/routes/presence.ts`).

### Phase 2 — Core migrations (protocol + engine + nodes + channels)

- Dual-stack WS handshake + `protocol_rev` gating, plus WS request router for the control plane (`packages/gateway/src/routes/ws.ts`, `packages/gateway/src/ws/protocol.ts`).
- Node role with pairing approvals + revocation (`packages/gateway/src/modules/node/*`, `packages/gateway/src/routes/pairing.ts`).
- Durable workflow APIs backed by execution engine + lifecycle events (`packages/gateway/src/routes/workflow.ts`, `packages/gateway/src/modules/execution/engine.ts`).
- Approvals wired to pause/resume tokens (`packages/gateway/src/routes/approval.ts`, `packages/gateway/src/modules/execution/engine.ts`).
- Telegram connector pipeline: durable inbox/outbox, dedupe/debounce, idempotent outbound sends, policy/approval gating (`packages/gateway/src/modules/channels/*`, `packages/gateway/src/modules/channels/telegram.ts`).
- Markdown → IR → chunk → render for Telegram (`packages/gateway/src/modules/markdown/*`).
- PolicyBundle loader + precedence merge + per-run snapshots + policy overrides (“approve always”) (`packages/gateway/src/modules/policy/*`, `packages/gateway/src/routes/policy-bundle.ts`).
- Auth profiles + deterministic model routing/rotation/pinning (`packages/gateway/src/routes/auth-profiles.ts`, `packages/gateway/src/routes/model-proxy.ts`).
- Multi-agent scoping in `AgentRegistry` + agent-scoped state (`packages/gateway/src/modules/agent/registry.ts`).
- Skills layering and plugin registry primitives (`packages/gateway/src/modules/agent/workspace.ts`, `packages/gateway/src/modules/plugins/*`).

### Phase 3 — Consolidation (compat windows + drift control)

- Legacy HTTP/plan paths remain available for compatibility, but the target-state subsystems exist and are exercised by tests (reduces drift while allowing staged cutovers).
- HA failure-matrix integration tests for edge/worker/scheduler crash and DB partition scenarios (`packages/gateway/tests/integration/failure-matrix.test.ts`).

---

## Appendix A: verification (commands run + key outputs)

All commands below were run locally on **2026-02-21** against this working tree (HEAD `e5baecf…`; includes uncommitted changes).

### Docs inventory

- `find docs/architecture -type f -name '*.md' -print | sort | wc -l` → `45` (includes this report)
- `find docs/architecture -type f -name '*.md' ! -name 'gap-analysis-v2.md' -print | sort | wc -l` → `44`
- `wc -l $(find docs/architecture -type f -name '*.md' ! -name 'gap-analysis-v2.md' -print | sort) | tail -n 1` → `2898 total`

### Quality gates

- `pnpm typecheck` → exit `0`
- `pnpm lint` → `Found 0 warnings and 0 errors.`
- `pnpm test` → `Test Files  140 passed | 1 skipped (141)` and `Tests  1021 passed | 2 skipped (1023)`
- `pnpm docs:public-check` → `public docs policy check passed`
- `pnpm --filter @tyrum/docs build` → exit `0`
- `pnpm build` → exit `0` (includes `@tyrum/docs build`)
- `pnpm exec tsc --noEmit --project apps/desktop/tsconfig.json` → exit `0`

### Split-role smoke (docker compose)

- `bash scripts/smoke-postgres-split.sh` → `[smoke] run 5a6fd569-6cf6-42ee-9060-c8f627b72ef6 succeeded` and `[smoke] ok`

### Helm render check

- `helm template tyrum charts/tyrum` → exit `0`
- `helm template tyrum charts/tyrum --set mode=split --set env.GATEWAY_DB_PATH=postgres://tyrum:tyrum@postgres:5432/tyrum` → exit `0`

### Key presence checks

- `rg -n "connect\\.init|connect\\.proof|protocol_rev" packages apps -S` → matches in `packages/schemas/src/protocol.ts`, `packages/gateway/src/routes/ws.ts`, `packages/client/src/ws-client.ts`
- `rg -n "PolicyBundle|policy_override" packages -S` → matches in policy schema/service/routes and overrides DAL
- `rg -n "workflow\\.run|workflow\\.resume|workflow\\.cancel|session\\.send|command\\.execute" packages -S` → matches in WS protocol and workflow routes
