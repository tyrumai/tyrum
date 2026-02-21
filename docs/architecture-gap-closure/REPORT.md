# Architecture Gap Closure Report

## 1) Run execution brief

Date (UTC): 2026-02-21T17:00:55Z  
Git HEAD: 1a826cbe47c89c380ff0defdbff31c86f7f398a2

- Goal (this run): Commit the implemented architecture gap closures, re-validate repo health (`pnpm typecheck && pnpm test && pnpm lint`), and finalize the durable gap-closure docs (`STATE.md`, `REPORT.md`, `LOG.md`).
- Non-goals: Big-bang refactors; changing protocol major versions; writing progress artifacts into `docs/architecture/`.
- Constraints: Node 24 + pnpm workspace; incremental & reversible changes; do not bypass lint/type/test gates; product not in use yet (no migration shadow modes required).
- Plan: Confirm docs + traceability are consistent → commit stabilized code → run baseline validations → update durable docs.
- Risks & rollback: Changes are large but now committed and covered by tests; roll back by reverting commit `1a826cb` and re-running validations.

## 2) Docs ingested

- docs/architecture/agent-loop.md
- docs/architecture/agent.md
- docs/architecture/approvals.md
- docs/architecture/artifacts.md
- docs/architecture/auth.md
- docs/architecture/automation.md
- docs/architecture/capabilities.md
- docs/architecture/channels.md
- docs/architecture/client.md
- docs/architecture/context-compaction.md
- docs/architecture/contracts.md
- docs/architecture/execution-engine.md
- docs/architecture/gateway/index.md
- docs/architecture/glossary.md
- docs/architecture/identity.md
- docs/architecture/index.md
- docs/architecture/markdown-formatting.md
- docs/architecture/memory.md
- docs/architecture/messages-sessions.md
- docs/architecture/models.md
- docs/architecture/multi-agent-routing.md
- docs/architecture/node.md
- docs/architecture/observability.md
- docs/architecture/playbooks.md
- docs/architecture/plugins.md
- docs/architecture/policy-overrides.md
- docs/architecture/presence.md
- docs/architecture/protocol/events.md
- docs/architecture/protocol/handshake.md
- docs/architecture/protocol/index.md
- docs/architecture/protocol/requests-responses.md
- docs/architecture/sandbox-policy.md
- docs/architecture/scaling-ha.md
- docs/architecture/secrets.md
- docs/architecture/sessions-lanes.md
- docs/architecture/skills.md
- docs/architecture/slash-commands.md
- docs/architecture/system-prompt.md
- docs/architecture/tools.md
- docs/architecture/workspace.md

## 3) Target architecture summary

### Components

- **Gateway (long-lived service):** owns WebSocket connectivity, auth, routing, contract validation, policy enforcement, approvals, orchestration, and durable state coordination.
- **StateStore:** SQLite for single-host; Postgres for HA/scale; contains durable state (sessions, execution, approvals, outbox, audits).
- **Event backplane:** outbox-backed at-least-once delivery abstraction (in-process for replica=1; shared in clusters).
- **Execution engine + workers:** durable run/step/attempt state machine, retries/idempotency, lane serialization, pause/resume, evidence.
- **ToolRunner:** workspace-mounted execution boundary (local subprocess on single-host; sandboxed job/pod in clusters).
- **Secret provider:** raw secret storage/resolution; gateway + executors use **secret handles**; raw values never enter model context.
- **Artifact store:** bytes in FS or S3-compatible store; metadata in StateStore; fetched via gateway with authorization.
- **Clients:** operator interfaces over WebSocket; approvals, pairing, observability (`/status`, `/context`, `/usage`), and control panel UI.
- **Nodes:** capability providers over WebSocket; device automation behind capabilities; require pairing approval and can be revoked.
- **Extensions:** tools/plugins/skills and MCP servers extend behavior via typed contracts.

### Trust boundaries and contracts

- WebSocket protocol between gateway and clients/nodes is typed and validated against `@tyrum/schemas`.
- Policies/approvals/sandboxing enforce behavior (prompts/skills are advisory only).

### Deployment / runtime expectations

- One logical architecture across single-host and clustered deployments; coordination primitives (leases + outbox) always present.
- Schedulers and workers use StateStore-backed **leases** to avoid double-work and enable failover.
- In clusters, only ToolRunner mounts the workspace filesystem to avoid multi-node RWO volume contention.

### Security model (high level)

- WebSocket auth via gateway token + device identity and proof (public-key-derived `device_id` + challenge signature).
- Secrets handled by **handles**; redaction at persistence and egress boundaries.
- PolicyBundle defines allow/deny/require-approval decisions; provenance tagging supports injection defense and conservative defaults.

### Observability

- Typed events for approvals, runs/steps, artifacts, policy decisions, presence, auth/model selection.
- Deterministic context reports and local usage accounting exposed via `/context` and `/usage`.

### Reliability invariants

- Durable truth lives in the StateStore; reconnects and at-least-once delivery are normal.
- Execution serialized per `(session_key, lane)`; retries require idempotency semantics; approvals pause/resume without re-running completed steps.

## 4) Current state inventory

### Repo map (architecture-relevant)

- TypeScript ESM monorepo (Node `24.x`, pnpm workspace): `package.json`.
- Core packages:
  - `packages/gateway/`: Hono HTTP server + `ws` WebSocket protocol + execution engine + persistence.
  - `packages/schemas/`: Zod contracts (`@tyrum/schemas`) including protocol + execution + policy bundle schemas.
  - `packages/client/`: client SDK (builds to ESM + d.ts).
- Apps:
  - `apps/desktop/`: Electron desktop client + embedded gateway manager.
  - `apps/docs/`: Docusaurus docs site.
- Deploy:
  - `docker-compose.yml`: single-host (`all`) and split-role (`edge|worker|scheduler`) examples.
  - `charts/tyrum/`: Helm chart supporting `mode=single|split`, ToolRunner jobs, Postgres enforcement in split mode.

### Gateway runtime entrypoints

- Gateway CLI + role selection: `packages/gateway/src/index.ts` (`tyrum [all|edge|worker|scheduler]`).
- HTTP routes registered in `packages/gateway/src/app.ts` (health, policy bundles, agent, approvals, context, usage, web UI, etc.).
- WebSocket upgrade handler: `packages/gateway/src/routes/ws.ts` (auth token via subprotocol, handshake, heartbeat, presence upsert/prune events).
- WebSocket message dispatch: `packages/gateway/src/ws/protocol.ts` (typed request/response dispatch + event publishing).

### StateStore (SQLite/Postgres) and coordination primitives

- Migrations exist for both backends: `packages/gateway/migrations/{sqlite,postgres}/*.sql`.
- Durable backplane outbox + consumer cursors:
  - Tables: `outbox`, `outbox_consumers` in `packages/gateway/migrations/sqlite/001_init.sql`.
  - DAL: `packages/gateway/src/modules/backplane/outbox-dal.ts`.
  - Poller: `packages/gateway/src/modules/backplane/outbox-poller.ts`.
- Connection directory for cross-edge capability routing:
  - Table: `connection_directory` in `packages/gateway/migrations/sqlite/001_init.sql`.
  - DAL: `packages/gateway/src/modules/backplane/connection-directory.ts`.
  - Heartbeat touch + cleanup: `packages/gateway/src/routes/ws.ts` (heartbeat tick).

### WebSocket protocol (contracts + handshake)

- Canonical wire unions: `packages/schemas/src/protocol.ts`.
- Token-in-subprotocol auth (`tyrum-auth.<base64url(token)>`), protocol rev check, device_id derivation, challenge + Ed25519 proof verification, node enrollment/scoped tokens, and capability restriction:
  - `packages/gateway/src/routes/ws.ts`.

### Execution engine (durable runs/steps/attempts + leases + idempotency + pause/resume)

- Core engine: `packages/gateway/src/modules/execution/engine.ts`.
- Durable tables (SQLite shown; Postgres equivalent exists):
  - `execution_jobs`, `execution_runs`, `execution_steps`, `execution_attempts`, `lane_leases`, `idempotency_records`, `resume_tokens`, `workspace_leases` in `packages/gateway/migrations/sqlite/001_init.sql`.
- Worker loop + ToolRunner execution boundary:
  - Worker loop: `packages/gateway/src/modules/execution/worker-loop.ts`.
  - Local ToolRunner (subprocess): `packages/gateway/src/modules/execution/toolrunner-step-executor.ts`.
  - Kubernetes ToolRunner (job/pod): `packages/gateway/src/modules/execution/kubernetes-toolrunner-step-executor.ts` + Helm wiring `charts/tyrum/templates/deployment-split.yaml`.
- Postcondition evaluation and “pause for manual intervention” on missing evidence:
  - `packages/gateway/src/modules/execution/engine.ts` (`evaluatePostcondition`, `pauseRunAndStep(...)`).

### Approvals (durable queue + WS + HTTP)

- DAL: `packages/gateway/src/modules/approval/dal.ts` (atomic `UPDATE ... WHERE status='pending'` for idempotent resolution).
- WS request handling: `packages/gateway/src/ws/protocol.ts` (`approval.list`, `approval.resolve`).
- HTTP route: `packages/gateway/src/routes/approval.ts`.

### Policy bundles, provenance-aware evaluation, and snapshots

- Policy bundle composition + snapshot storage: `packages/gateway/src/modules/policy-bundle/service.ts`.
- Evaluation: `packages/gateway/src/modules/policy-bundle/evaluate.ts` (tool/action/network/secrets + provenance rules; missing provenance → conservative `require_approval` when provenance rules exist).
- Policy snapshot tables + execution_runs columns: `packages/gateway/migrations/sqlite/002_presence_policy.sql`.

### Secrets + redaction

- Secret providers: `packages/gateway/src/modules/secret/provider.ts` + `packages/gateway/src/modules/secret/create-secret-provider.ts` (env/file/keychain selection).
- Central redaction engine used at persistence/egress boundaries: `packages/gateway/src/modules/redaction/engine.ts`.

### Artifacts (bytes store + execution attachments)

- Pluggable artifact store (fs + s3): `packages/gateway/src/modules/artifact/store.ts` + `packages/gateway/src/modules/artifact/create-artifact-store.ts`.
- Step executor writes artifacts and attaches `ArtifactRef[]` into `execution_attempts.artifacts_json`:
  - `packages/gateway/src/modules/execution/local-step-executor.ts` (artifact storage helpers).
- Note: there is no dedicated `artifacts` metadata table or gateway artifact fetch route; artifacts are currently stored/attached as refs in attempt JSON and only canvas artifacts are browsable via web UI (`packages/gateway/src/routes/web-ui.ts`).

### Presence

- Presence tables: `packages/gateway/migrations/sqlite/002_presence_policy.sql`.
- DAL + service: `packages/gateway/src/modules/presence/{dal.ts,service.ts}`.
- Presence upsert and prune events emitted from WS handler heartbeat: `packages/gateway/src/routes/ws.ts`.

### Channels (Telegram) + normalization + dedupe/debounce + outbound gating

- Telegram ingress: `packages/gateway/src/modules/ingress/telegram*.ts` + HTTP ingress routes in `packages/gateway/src/routes/ingress.ts`.
- Channel worker:
  - DB-leased poller loop: `packages/gateway/src/modules/channels/worker.ts` (uses `scheduler_leases`).
  - Inbound dedupe (`channel_inbound_messages` with unique keys) + debounce window: `packages/gateway/src/modules/channels/inbox-dal.ts` + `packages/gateway/src/modules/channels/worker.ts`.
  - Outbound sends with idempotency keys + policy bundle gating + approvals: `packages/gateway/src/modules/channels/outbox-dal.ts` + `packages/gateway/src/modules/channels/worker.ts`.
  - Session key formatting with DM isolation default `per_account_channel_peer`: `packages/gateway/src/modules/channels/session-key.ts`.

### Markdown formatting (IR + chunk + render + fallback)

- Markdown IR tokenizer + chunker + Telegram HTML renderer: `packages/gateway/src/modules/formatting/markdown-ir.ts`.
- Channel worker uses IR and records episodic events on degradation/fallback: `packages/gateway/src/modules/channels/worker.ts`.

### Observability surfaces

- Context reports: persisted via `packages/gateway/src/modules/observability/context-report-dal.ts` and exposed in `packages/gateway/src/routes/context.ts`.
- Usage accounting: `packages/gateway/src/routes/usage.ts` (local usage from context reports + attempt cost JSON; provider polling currently `disabled`).

## 5) Architecture Requirements Index (ARI)

ARI requirements are defined as atomic, testable statements extracted from `docs/architecture/*`.

**Stable ARI ID algorithm**

- `ARI-<8HEX>` is the first 8 hex characters of `sha1(doc_relative_path + "::" + heading + "::" + normalized_requirement_text)`.
- `normalized_requirement_text` is `trim()` + collapse all whitespace to single spaces.

| ARI ID | Tags | Source | Requirement |
| --- | --- | --- | --- |
| ARI-08c4e108 | security, ops | docs/architecture/sandbox-policy.md — Provenance and injection defense | Inputs from tools web pages channels and connectors MUST be tagged with provenance and treated as data so policy can enforce rules based on provenance |
| ARI-08e44479 | interface, security, ops | docs/architecture/markdown-formatting.md — Pipeline | Outbound channel formatting MUST parse Markdown into a neutral IR then chunk the IR safely before rendering and on parse or render failure MUST fall back to plain text and emit an event |
| ARI-0fb16f0f | ops, data, security | docs/architecture/execution-engine.md — Pause/resume | When a run pauses for approval the engine MUST persist an opaque resume token that maps to paused state and MUST resume without re-running completed steps once approved |
| ARI-28b2cd2f | security, interface | docs/architecture/protocol/handshake.md — Auth | The gateway MUST validate the access token supplied during WebSocket upgrade via sec-websocket-protocol entry tyrum-auth.<base64url(token)> |
| ARI-2b3bdb7d | security, interface | docs/architecture/node.md — Pairing posture | Nodes MUST be paired and approved before executing capabilities and pairing MUST bind a capability allowlist and be revocable |
| ARI-2ee05fc8 | deploy, ops, data | docs/architecture/scaling-ha.md — WebSocket routing (connection directory) | Each gateway edge MUST heartbeat active connections with TTL into the StateStore including role device_id and capability summaries so directed dispatch can route to the owning edge |
| ARI-3fdecc2e | security, interface | docs/architecture/protocol/handshake.md — Flow | The gateway MUST issue a fresh challenge nonce per connection and MUST verify connect.proof proof as a signature over the challenge and a transcript that binds protocol_rev role and device_id |
| ARI-49fec0a3 | ops, interface | docs/architecture/presence.md — TTL and bounded size | Presence entries MUST be TTL-pruned and size capped and prunes MUST emit events so UIs can remove stale rows |
| ARI-4b4147b2 | data, ops, security | docs/architecture/sandbox-policy.md — Policy snapshots | Each execution run MUST carry a persisted policy_snapshot_id and content hash for the merged policy used to create the run |
| ARI-4cfbe6b1 | data, security, ops | docs/architecture/workspace.md — Durability (hard requirement) | The workspace filesystem MUST be persistent across runs and the system MUST enforce workspace path boundaries and avoid logging sensitive file contents |
| ARI-50c2e6b4 | security, ops, compliance | docs/architecture/execution-engine.md — Evidence + postconditions (hard rule) | For state-changing steps the engine MUST evaluate a postcondition when feasible and persist evidence artifacts and if a step cannot be verified the outcome MUST be marked unverifiable and require operator escalation before further dependent side effects |
| ARI-5472a6d7 | security, compliance | docs/architecture/secrets.md — Requirements | Raw secret values MUST stay out of model context and out of logs and persisted state and tools and capability providers MUST accept secret handles not secret values |
| ARI-5772b95c | data, security, ops | docs/architecture/artifacts.md — Artifact store | Artifact metadata MUST be persisted in the StateStore while raw bytes live in an artifact store and clients MUST fetch artifact bytes through the gateway with authorization |
| ARI-5f66c853 | data, ops | docs/architecture/execution-engine.md — Responsibilities | The execution engine MUST persist a durable run state machine with statuses queued running paused succeeded failed and cancelled |
| ARI-644da0ce | deploy, ops, security | docs/architecture/scaling-ha.md — Workspace durability and mount semantics (the `TYRUM_HOME` reality) | Only ToolRunner MUST mount the workspace filesystem and long-lived gateway edge scheduler and control-plane worker processes MUST be stateless with respect to workspace POSIX volumes in clustered deployments |
| ARI-6c85f85a | security, data | docs/architecture/sessions-lanes.md — Direct-message scope (secure DM mode) | When more than one distinct sender can DM an agent the default dm_scope MUST isolate by (account channel sender) to prevent cross-user context leakage |
| ARI-77a5cb85 | security, ops | docs/architecture/multi-agent-routing.md — Isolation model | Workspaces sessions memory tools and secrets MUST be scoped per agent_id and cross-agent access MUST be deny-by-default unless explicitly allowed by policy |
| ARI-7ce191e9 | ops, data, deploy | docs/architecture/messages-sessions.md — Inbound dedupe (don’t run twice) | Inbound message deliveries MUST be deduplicated before enqueue using a stable key like (channel account_id container_id message_id) stored durably so duplicates do not spawn duplicate runs |
| ARI-7d56f36b | interface, ops | docs/architecture/protocol/events.md — Delivery expectations | Events MUST be delivered at-least-once and consumers MUST deduplicate using event_id |
| ARI-86c1d9b2 | security, ops | docs/architecture/sandbox-policy.md — Composition and precedence | Effective policy MUST be the conservative merge of deployment agent and playbook policy where deny wins over require_approval wins over allow |
| ARI-878e8a8e | security, ops | docs/architecture/approvals.md — Approve once vs approve always | Approvals MUST support approve once and approve always and approve always MUST create a durable policy override that can be revoked and audited |
| ARI-8b1efb1c | security, compliance | docs/architecture/policy-overrides.md — Evaluation semantics | Policy overrides MUST NOT bypass an explicit deny and MUST only relax require_approval to allow for matching tool actions |
| ARI-99539f72 | interface, ops | docs/architecture/protocol/requests-responses.md — Request envelope | Requests and responses MUST be correlated by request_id and errors MUST be structured with explicit error codes |
| ARI-9c8232b4 | ops, performance | docs/architecture/models.md — Selection and fallback | On model call failure the system MUST rotate auth profiles within the provider before falling back to the next model in the configured chain |
| ARI-a05fce19 | security, interface | docs/architecture/protocol/handshake.md — Connect payload | The system MUST derive device_id deterministically from the device public key and use it as the durable device identity for pairing revocation and audit |
| ARI-a35b9371 | interface, security | docs/architecture/protocol/index.md — Protocol revisions | The gateway MUST accept a connection only when the peer handshake protocol_rev matches the gateway supported protocol revision |
| ARI-b9c05de5 | security, ops, data | docs/architecture/auth.md — Auth profiles | Provider auth profiles MUST be stored as metadata plus secret handles scoped per agent_id and must support deterministic selection pinning rotation and disablement |
| ARI-bed2870e | deploy, ops, data | docs/architecture/scaling-ha.md — Event backplane | Cluster deployments MUST deliver events and commands via a durable outbox in the StateStore with at-least-once semantics |
| ARI-c5a20479 | ops, data, deploy | docs/architecture/sessions-lanes.md — Distributed serialization (all deployments) | Execution MUST be serialized per (key lane) across deployments using StateStore-backed coordination so at most one run executes per (key lane) at a time |
| ARI-cd9a2ae2 | interface, security | docs/architecture/protocol/index.md — Protocol | Protocol messages MUST be validated against versioned contracts at trust boundaries |
| ARI-ce92b6e1 | security, ops | docs/architecture/secrets.md — Access model | Secret handle resolution MUST occur at the last responsible moment in a trusted execution context and MUST be policy-gated and audited |
| ARI-d0e169d0 | security, interface | docs/architecture/approvals.md — Suggested overrides (pattern suggestions) | Tool-policy approvals SHOULD include a bounded suggested_overrides list of conservative per-tool wildcard patterns that never propose bypassing an explicit deny |
| ARI-d168dd33 | data, interface | docs/architecture/sessions-lanes.md — Key scheme | Session keys MUST follow the documented schemes and be chosen by Tyrum not by the model to make routing audit and replay reliable |
| ARI-ded1b7fa | ops, performance | docs/architecture/observability.md — Usage and cost | The system MUST persist local token and time accounting per run step and attempt and expose it via /usage and provider usage polling when enabled MUST be cached rate-limited non-fatal and policy-respecting |
| ARI-e49fa872 | ops, interface | docs/architecture/messages-sessions.md — Queue modes | When a run is active for a (session_key lane) the system MUST apply an explicit queue mode (collect followup steer steer_backlog interrupt) with bounded cap overflow policy and observable overflow handling |
| ARI-e6ac01f2 | security, interface | docs/architecture/policy-overrides.md — Matching and pattern language | Policy override patterns MUST support wildcard grammar where * matches zero or more characters and ? matches exactly one character |
| ARI-e95d3b3e | ops, testing | docs/architecture/observability.md — Context inspection | The gateway MUST generate deterministic per-run context reports including tool schema overhead and expose them via /context list and /context detail |
| ARI-ee5d759f | ops, data, deploy | docs/architecture/execution-engine.md — Distributed execution (workers) | Workers MUST claim attempts with time-bounded leases in the StateStore enforce lane serialization via (session_key lane) locks or leases and implement durable idempotency keys with cached outcomes for safe retries |
| ARI-f7f4a814 | data, ops | docs/architecture/approvals.md — Cluster notes | Approval resolution MUST apply pending to approved denied or expired transitions atomically in durable storage so double submission is safe |
| ARI-faf29e52 | ops, deploy | docs/architecture/automation.md — Scheduler safety (DB-leases) | Schedulers MUST coordinate automation triggers using StateStore-backed DB leases to avoid double-firing across replicas |

## 6) Traceability Matrix

Columns: ARI ID • Requirement • Tags • Status • Evidence • Notes

| ARI ID | Requirement | Tags | Status | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| ARI-08c4e108 | Inputs from tools web pages channels and connectors MUST be tagged with provenance and treated as data so policy can enforce rules based on provenance | security, ops | Implemented | `packages/gateway/src/modules/agent/runtime.ts` (parses `metadata.provenance_sources`, wraps non-user/system content in `<data source="...">`, promotes provenance across tool calls, passes provenance into policy evaluation + approvals)<br/>`packages/gateway/src/modules/agent/tool-executor.ts` (tags tool outputs; `tool.http.fetch` tagged as `web`)<br/>`packages/gateway/src/modules/channels/worker.ts` (propagates inbound provenance into agent turn; uses derived provenance for outbound action policy)<br/>`packages/schemas/src/agent.ts` (returns `provenance_sources` from agent turns)<br/>Tests: `packages/gateway/tests/integration/tool-loop.test.ts`, `packages/gateway/tests/integration/telegram-e2e.test.ts` | User intent remains direct `user` input; externally sourced content (web/tool/connector/email/etc) is tagged and treated as DATA for injection defense and provenance-aware policy rules. |
| ARI-08e44479 | Outbound channel formatting MUST parse Markdown into a neutral IR then chunk the IR safely before rendering and on parse or render failure MUST fall back to plain text and emit an event | interface, security, ops | Implemented | `packages/gateway/src/modules/formatting/markdown-ir.ts` (`parseMarkdownToIr`, `chunkMarkdownIr`, `renderTelegramHtml`)<br/>`packages/gateway/src/modules/channels/worker.ts` (IR render, fallback + episodic events `formatting_fallback`/`formatting_degraded`) | Currently implemented for Telegram; other channel renderers are not present yet. |
| ARI-0fb16f0f | When a run pauses for approval the engine MUST persist an opaque resume token that maps to paused state and MUST resume without re-running completed steps once approved | ops, data, security | Implemented | `packages/gateway/src/modules/execution/engine.ts` (`resume_tokens`, `resumeRun(...)`, approval pause path)<br/>`packages/gateway/src/ws/protocol.ts` (`workflow.resume`)<br/>`packages/gateway/tests/unit/execution-engine.test.ts` (pause + resume token tests) | Token expiry columns exist; expiry enforcement is not surfaced as a separate operator feature yet. |
| ARI-28b2cd2f | The gateway MUST validate the access token supplied during WebSocket upgrade via sec-websocket-protocol entry tyrum-auth.<base64url(token)> | security, interface | Implemented | `packages/gateway/src/routes/ws.ts` (`extractWsTokenFromProtocols`, `WS_AUTH_PROTOCOL_PREFIX`)<br/>`packages/gateway/tests/integration/ws-handler.test.ts` (rejects invalid token) | Aligns with architecture handshake doc. |
| ARI-2b3bdb7d | Nodes MUST be paired and approved before executing capabilities and pairing MUST bind a capability allowlist and be revocable | security, interface | Implemented | `packages/gateway/src/routes/ws.ts` (pairing observe, capability restriction, scoped token issuance + revocation)<br/>`packages/gateway/src/modules/node/pairing-service.ts`<br/>`packages/gateway/src/modules/node/token-dal.ts` | Loopback auto-approval is supported via `TYRUM_NODE_AUTO_APPROVE_LOOPBACK` (dev convenience). |
| ARI-2ee05fc8 | Each gateway edge MUST heartbeat active connections with TTL into the StateStore including role device_id and capability summaries so directed dispatch can route to the owning edge | deploy, ops, data | Implemented | `packages/gateway/src/modules/backplane/connection-directory.ts`<br/>`packages/gateway/src/routes/ws.ts` (heartbeat tick touches + cleanup)<br/>`packages/gateway/src/ws/protocol.ts` (`dispatchTask` uses directory for cross-edge routing) | Capability routing uses directory only when local edge has no capable client and `deps.cluster` is configured. |
| ARI-3fdecc2e | The gateway MUST issue a fresh challenge nonce per connection and MUST verify connect.proof proof as a signature over the challenge and a transcript that binds protocol_rev role and device_id | security, interface | Implemented | `packages/gateway/src/routes/ws.ts` (`challenge = randomBytes(...)`, `handshakeTranscript`, Ed25519 `verify(...)`)<br/>`packages/gateway/tests/integration/ws-handler.test.ts` (handshake completes via `TyrumClient`) | Signature is validated against a DER SPKI key built from the base Ed25519 prefix + pubkey bytes. |
| ARI-49fec0a3 | Presence entries MUST be TTL-pruned and size capped and prunes MUST emit events so UIs can remove stale rows | ops, interface | Implemented | `packages/gateway/src/modules/presence/service.ts` (`prune`, TTL + maxEntries)<br/>`packages/gateway/src/routes/ws.ts` (heartbeat emits `presence.prune`)<br/>`packages/gateway/migrations/sqlite/002_presence_policy.sql` (`presence_entries`) | Presence is best-effort; pruning + events are emitted only when presence is enabled on the gateway instance. |
| ARI-4b4147b2 | Each execution run MUST carry a persisted policy_snapshot_id and content hash for the merged policy used to create the run | data, ops, security | Implemented | `packages/gateway/migrations/sqlite/002_presence_policy.sql` (`policy_snapshots`, `execution_runs.policy_snapshot_*`)<br/>`packages/gateway/src/modules/policy-bundle/service.ts` (`getOrCreateSnapshot`)<br/>`packages/gateway/src/modules/execution/engine.ts` (stores snapshot on run) | Policy snapshot content is hashed and de-duplicated by content hash. |
| ARI-4cfbe6b1 | The workspace filesystem MUST be persistent across runs and the system MUST enforce workspace path boundaries and avoid logging sensitive file contents | data, security, ops | Implemented | `docs/architecture/workspace.md` (target)<br/>`packages/gateway/src/modules/agent/tool-executor.ts` (`assertSandboxed`, `sanitizeEnv`)<br/>`docker-compose.yml` (mounts `/var/lib/tyrum`), `charts/tyrum/templates/pvc.yaml` | Persistence is deployment-dependent (volume/PVC). Boundary enforcement exists for gateway-local fs tools. |
| ARI-50c2e6b4 | For state-changing steps the engine MUST evaluate a postcondition when feasible and persist evidence artifacts and if a step cannot be verified the outcome MUST be marked unverifiable and require operator escalation before further dependent side effects | security, ops, compliance | Implemented | `packages/gateway/src/modules/execution/engine.ts` (postcondition evaluation + “pause on missing evidence”)<br/>`packages/gateway/tests/unit/execution-engine.test.ts` (missing-evidence pause + resume) | Current pause reason is `manual`; aligns with “escalate for operator intervention” semantics. |
| ARI-5472a6d7 | Raw secret values MUST stay out of model context and out of logs and persisted state and tools and capability providers MUST accept secret handles not secret values | security, compliance | Implemented | `packages/gateway/src/modules/secret/provider.ts` (handle-based providers)<br/>`packages/gateway/src/modules/agent/tool-executor.ts` (`secret:<handle_id>` resolution + output redaction)<br/>`packages/gateway/src/modules/policy-bundle/evaluate.ts` (secret resolution policy via handle ids)<br/>`packages/gateway/tests/unit/tool-executor-secrets.test.ts` | Raw secrets exist only in trusted execution contexts (providers/tool execution) and are redacted before tool outputs reach the model or logs. |
| ARI-5772b95c | Artifact metadata MUST be persisted in the StateStore while raw bytes live in an artifact store and clients MUST fetch artifact bytes through the gateway with authorization | data, security, ops | Implemented | Migrations: `packages/gateway/migrations/sqlite/012_artifacts.sql`, `packages/gateway/migrations/postgres/012_artifacts.sql` (artifact metadata table)<br/>`packages/gateway/src/modules/artifact/store.ts` + `packages/gateway/src/modules/artifact/create-artifact-store.ts` (fs + s3 byte stores)<br/>`packages/gateway/src/modules/artifact/dal.ts` (metadata DAL)<br/>`packages/gateway/src/modules/execution/engine.ts` (persists artifact metadata on attempt completion)<br/>Gateway fetch: `packages/gateway/src/routes/artifacts.ts` (`GET /artifact/:artifactId` + `/meta`)<br/>Tests: `packages/gateway/tests/unit/execution-engine.test.ts`, `packages/gateway/tests/integration/artifact-fetch.test.ts` | Fetch is authenticated via existing gateway admin token middleware; fine-grained policy/sensitivity authorization is a follow-up. |
| ARI-5f66c853 | The execution engine MUST persist a durable run state machine with statuses queued running paused succeeded failed and cancelled | data, ops | Implemented | `packages/gateway/migrations/sqlite/001_init.sql` (`execution_runs.status` etc.)<br/>`packages/gateway/src/modules/execution/engine.ts` (state transitions)<br/>`packages/gateway/tests/unit/execution-engine.test.ts` | Run/job status enums align with docs; job status uses `completed` rather than `succeeded`. |
| ARI-644da0ce | Only ToolRunner MUST mount the workspace filesystem and long-lived gateway edge scheduler and control-plane worker processes MUST be stateless with respect to workspace POSIX volumes in clustered deployments | deploy, ops, security | Implemented | `packages/gateway/src/index.ts` (worker uses `createKubernetesToolRunnerStepExecutor` to launch workspace-mounted jobs/pods)<br/>`charts/tyrum/templates/deployment-split.yaml` (sets ToolRunner env; requires persistence) | Split-role mode explicitly requires Postgres + persistence; ToolRunner mounting happens only in Kubernetes launcher mode. |
| ARI-6c85f85a | When more than one distinct sender can DM an agent the default dm_scope MUST isolate by (account channel sender) to prevent cross-user context leakage | security, data | Implemented | `packages/gateway/src/modules/channels/session-key.ts` (per-account/channel/peer key format)<br/>`packages/gateway/src/modules/channels/worker.ts` (default `dmScope = per_account_channel_peer`) | DM scope is configurable via env; default is secure isolation. |
| ARI-77a5cb85 | Workspaces sessions memory tools and secrets MUST be scoped per agent_id and cross-agent access MUST be deny-by-default unless explicitly allowed by policy | security, ops | Implemented | `packages/gateway/src/modules/agent/home.ts` (agent-scoped home/workspace)<br/>`packages/gateway/src/modules/agent/session-dal.ts` (agent-namespaced `session_id` formatting)<br/>`packages/gateway/src/modules/channels/session-key.ts` (agentId embedded into session keys)<br/>`packages/gateway/migrations/sqlite/013_agent_scope_memory.sql` + `packages/gateway/migrations/postgres/013_agent_scope_memory.sql` (memory tables gain `agent_id` + scoped uniqueness)<br/>`packages/gateway/src/modules/memory/dal.ts` + `packages/gateway/src/modules/memory/vector-dal.ts` (agent-scoped queries)<br/>`packages/gateway/src/routes/memory.ts` (agent scoping via query/header/env default) | Cross-agent access remains token-gated operator behavior; explicit policy gating for cross-agent reads is not implemented yet. |
| ARI-7ce191e9 | Inbound message deliveries MUST be deduplicated before enqueue using a stable key like (channel account_id container_id message_id) stored durably so duplicates do not spawn duplicate runs | ops, data, deploy | Implemented | `packages/gateway/src/modules/channels/inbox-dal.ts` (unique key + dedupe semantics)<br/>`packages/gateway/src/modules/channels/worker.ts` (dedupe episodic events) | Overflow policy currently implemented as `drop_oldest` with episodic events. |
| ARI-7d56f36b | Events MUST be delivered at-least-once and consumers MUST deduplicate using event_id | interface, ops | Implemented | `packages/gateway/src/ws/protocol.ts` (events include `event_id`; broadcast helpers)<br/>`packages/gateway/src/modules/backplane/outbox-poller.ts` (cursor ack-after-processing)<br/>`packages/gateway/tests/unit/outbox-poller.test.ts` (cursor behavior coverage)<br/>`packages/client/src/ws-client.ts` (bounded dedupe by `event_id`)<br/>`packages/client/tests/ws-client.test.ts` (dedupe test) | At-least-once is provided at the edge boundary via the outbox cursor; the client dedupes by `event_id` to tolerate duplicates. Other consumers should dedupe similarly. |
| ARI-86c1d9b2 | Effective policy MUST be the conservative merge of deployment agent and playbook policy where deny wins over require_approval wins over allow | security, ops | Implemented | `packages/gateway/src/modules/policy-bundle/service.ts` (`combineEffect`, merge functions)<br/>`packages/gateway/tests/unit/policy-bundle-service.test.ts` | Operator “approve always” overrides are not yet implemented (see gaps). |
| ARI-878e8a8e | Approvals MUST support approve once and approve always and approve always MUST create a durable policy override that can be revoked and audited | security, ops | Implemented | `packages/schemas/src/approval.ts` (mode=`once|always`, `selected_override`, resolution `policy_override_id`)<br/>Migrations: `packages/gateway/migrations/sqlite/011_policy_overrides.sql`, `packages/gateway/migrations/postgres/011_policy_overrides.sql`<br/>`packages/gateway/src/modules/approval/apply.ts` (mode=always creates override atomically; stores `policy_override_id`)<br/>HTTP/WS/UI: `packages/gateway/src/routes/approval.ts`, `packages/gateway/src/ws/protocol.ts`, `packages/gateway/src/routes/web-ui.ts`<br/>Revoke/audit surface: `packages/gateway/src/routes/policy-overrides.ts`, events in `packages/schemas/src/protocol.ts` | Approve-always is constrained to conservative, tool-scoped overrides and remains auditable/revocable. |
| ARI-8b1efb1c | Policy overrides MUST NOT bypass an explicit deny and MUST only relax require_approval to allow for matching tool actions | security, compliance | Implemented | `packages/gateway/src/modules/policy-bundle/service.ts` (applies overrides only when base decision is `require_approval`; explicit `deny` remains sticky)<br/>`packages/gateway/src/modules/policy-overrides/dal.ts` + `packages/gateway/src/modules/policy-overrides/match-target.ts` (override storage + match targets)<br/>`packages/gateway/tests/unit/policy-bundle-service.test.ts` (override decision lattice tests) | Overrides are strictly monotonic (cannot widen beyond relaxing `require_approval` → `allow`). |
| ARI-99539f72 | Requests and responses MUST be correlated by request_id and errors MUST be structured with explicit error codes | interface, ops | Implemented | `packages/schemas/src/protocol.ts` (request/response envelopes)<br/>`packages/gateway/src/ws/protocol.ts` (`errorResponse` uses `WsError` codes)<br/>`packages/gateway/tests/unit/ws-protocol.test.ts` | Request retry/idempotency semantics are request-type-specific; some idempotency is implemented in execution engine and channels. |
| ARI-9c8232b4 | On model call failure the system MUST rotate auth profiles within the provider before falling back to the next model in the configured chain | ops, performance | Implemented | `packages/gateway/src/modules/auth-profiles/service.ts` (`resolveBearerToken`, `rotateBearerToken`, cooldown/disable)<br/>`packages/gateway/src/routes/model-proxy.ts` (retryable failure classification; rotates profiles before trying `fallback_chain` models; adds `x-tyrum-model-used`/`x-tyrum-provider-used` headers)<br/>`packages/gateway/tests/unit/model-proxy.test.ts` (rotation + fallback tests) | Chain is configured per model via `fallback_chain` in the model gateway YAML; DB-backed auth rotation requires `x-tyrum-session-id` headers (falls back to legacy static auth when absent). |
| ARI-a05fce19 | The system MUST derive device_id deterministically from the device public key and use it as the durable device identity for pairing revocation and audit | security, interface | Implemented | `packages/gateway/src/routes/ws.ts` (`deriveDeviceId`, device_id check)<br/>`packages/schemas/src/base32.ts` | Uses `dev-` prefix with base32(sha256(pubkey)). |
| ARI-a35b9371 | The gateway MUST accept a connection only when the peer handshake protocol_rev matches the gateway supported protocol revision | interface, security | Implemented | `packages/gateway/src/routes/ws.ts` (`protocol_rev` vs `WS_PROTOCOL_REV` check)<br/>`packages/schemas/src/protocol.ts` (`WS_PROTOCOL_REV`) | Protocol rev mismatch closes with code `4005`. |
| ARI-b9c05de5 | Provider auth profiles MUST be stored as metadata plus secret handles scoped per agent_id and must support deterministic selection pinning rotation and disablement | security, ops, data | Implemented | `packages/gateway/src/modules/auth-profiles/service.ts` (pinning, cooldown, disable)<br/>`packages/gateway/src/modules/auth-profiles/dal.ts`<br/>`packages/gateway/tests/unit/auth-profiles.test.ts` | OAuth refresh is implemented with DB-backed refresh locks. |
| ARI-bed2870e | Cluster deployments MUST deliver events and commands via a durable outbox in the StateStore with at-least-once semantics | deploy, ops, data | Implemented | `packages/gateway/migrations/sqlite/001_init.sql` (`outbox`, `outbox_consumers`)<br/>`packages/gateway/src/modules/backplane/outbox-dal.ts` + `packages/gateway/src/modules/backplane/outbox-poller.ts` (ack-after-processing)<br/>Cross-edge enqueue usage in `packages/gateway/src/ws/protocol.ts` and `packages/gateway/src/routes/ws.ts`<br/>`packages/gateway/tests/unit/outbox-poller.test.ts` | OutboxPoller only advances the consumer cursor after processing each row; unexpected delivery failures do not advance the cursor, preserving at-least-once semantics. |
| ARI-c5a20479 | Execution MUST be serialized per (key lane) across deployments using StateStore-backed coordination so at most one run executes per (key lane) at a time | ops, data, deploy | Implemented | `packages/gateway/migrations/sqlite/001_init.sql` (`lane_leases`)<br/>`packages/gateway/src/modules/execution/engine.ts` (`tryAcquireLaneLease`, `releaseLaneLease`) | Concurrency/serialization is enforced by lane leases; tests focus on lease expiry/takeover at attempt level. |
| ARI-cd9a2ae2 | Protocol messages MUST be validated against versioned contracts at trust boundaries | interface, security | Implemented | `packages/gateway/src/routes/ws.ts` (`WsConnectInitRequest`, `WsConnectProofRequest` parsing)<br/>`packages/gateway/src/ws/protocol.ts` (`WsMessageEnvelope.safeParse`)<br/>`packages/gateway/tests/unit/ws-protocol.test.ts` | Contract errors are returned as structured WS error responses for supported request types. |
| ARI-ce92b6e1 | Secret handle resolution MUST occur at the last responsible moment in a trusted execution context and MUST be policy-gated and audited | security, ops | Implemented | `packages/gateway/src/modules/agent/runtime.ts` (policy check before tool execution)<br/>`packages/gateway/src/modules/agent/tool-executor.ts` (`resolveSecrets`, `auditSecretResolution`, redaction) | Secret resolution policy is enforced via PolicyBundle evaluation; secret resolutions are appended to the planner event log. |
| ARI-d0e169d0 | Tool-policy approvals SHOULD include a bounded suggested_overrides list of conservative per-tool wildcard patterns that never propose bypassing an explicit deny | security, interface | Implemented | `packages/schemas/src/approval.ts` (`suggested_overrides` + selection schema)<br/>`packages/gateway/src/modules/policy-overrides/match-target.ts` (computes per-tool match target + suggestions)<br/>`packages/gateway/src/modules/agent/runtime.ts` (populates `suggested_overrides` for tool-policy approvals)<br/>`packages/gateway/src/routes/web-ui.ts` (renders approve-always UI with suggested choices) | Suggestions are capped (≤10) and intended to be conservative (tool-scoped, narrow patterns). |
| ARI-d168dd33 | Session keys MUST follow the documented schemes and be chosen by Tyrum not by the model to make routing audit and replay reliable | data, interface | Implemented | `packages/gateway/src/modules/channels/session-key.ts` (key scheme for DM/group/channel)<br/>`packages/gateway/src/modules/channels/worker.ts` (constructs session keys; sets secure DM scope) | Cron/hook/node key schemes exist in `@tyrum/schemas` but are not all exercised by channel codepaths yet. |
| ARI-ded1b7fa | The system MUST persist local token and time accounting per run step and attempt and expose it via /usage and provider usage polling when enabled MUST be cached rate-limited non-fatal and policy-respecting | ops, performance | Implemented | `packages/gateway/src/routes/usage.ts` (local aggregation + provider polling integration)<br/>`packages/gateway/src/modules/observability/provider-usage.ts` (cached/rate-limited polling; policy-checked; prefers auth profiles)<br/>`packages/gateway/tests/unit/usage-route.test.ts` (polling + caching + non-fatal error) | Provider polling is default-off (`TYRUM_PROVIDER_USAGE_POLLING=1`) and requires per-provider usage endpoint config in model gateway YAML (`auth_profiles.<provider>.usage_endpoint` or `.usage.endpoint`). |
| ARI-e49fa872 | When a run is active for a (session_key lane) the system MUST apply an explicit queue mode (collect followup steer steer_backlog interrupt) with bounded cap overflow policy and observable overflow handling | ops, interface | Implemented | `packages/gateway/src/modules/channels/worker.ts` (queue modes + observable drop events; `queueMode`/`queueCap`/`queueOverflow` knobs)<br/>`packages/gateway/src/modules/channels/inbox-dal.ts` (cap + overflow policies `drop_oldest|drop_newest|summarize_dropped`)<br/>`packages/gateway/tests/unit/channel-queue.test.ts` | Implemented for channel ingress; steering/interrupt behavior applies at turn boundaries (backlog prioritization), not true in-flight tool-boundary injection. |
| ARI-e6ac01f2 | Policy override patterns MUST support wildcard grammar where * matches zero or more characters and ? matches exactly one character | security, interface | Implemented | `packages/gateway/src/modules/policy-bundle/evaluate.ts` (`matchesGlob` supports `*` + `?`; host matching delegates glob patterns with `?`)<br/>`packages/gateway/tests/unit/policy-bundle-service.test.ts` (tests for `?` and `*` semantics) | Added unit coverage for both tool and host wildcard matching. |
| ARI-e95d3b3e | The gateway MUST generate deterministic per-run context reports including tool schema overhead and expose them via /context list and /context detail | ops, testing | Implemented | `packages/gateway/src/modules/agent/runtime.ts` (`persistContextReport`, tool schema overhead)<br/>`packages/gateway/src/modules/observability/context-report-dal.ts`<br/>`packages/gateway/src/routes/context.ts` | Surface is via HTTP routes; slash command layer is client responsibility. |
| ARI-ee5d759f | Workers MUST claim attempts with time-bounded leases in the StateStore enforce lane serialization via (session_key lane) locks or leases and implement durable idempotency keys with cached outcomes for safe retries | ops, data, deploy | Implemented | `packages/gateway/src/modules/execution/engine.ts` (attempt leases + idempotency_records write-through)<br/>`packages/gateway/tests/integration/ha-failure-matrix.test.ts` (attempt lease takeover)<br/>`packages/gateway/tests/unit/execution-engine.test.ts` (idempotency short-circuit) | Lease recovery is tested; lane lease contention is not heavily exercised in tests yet. |
| ARI-f7f4a814 | Approval resolution MUST apply pending to approved denied or expired transitions atomically in durable storage so double submission is safe | data, ops | Implemented | `packages/gateway/src/modules/approval/dal.ts` (`UPDATE ... WHERE status='pending'`)<br/>`packages/gateway/src/routes/approval.ts` (409 on conflict)<br/>`packages/gateway/tests/integration/approval.test.ts` | WS `approval.resolve` path also handles already-resolved conflicts. |
| ARI-faf29e52 | Schedulers MUST coordinate automation triggers using StateStore-backed DB leases to avoid double-firing across replicas | ops, deploy | Implemented | `packages/gateway/migrations/sqlite/005_scheduler_leases.sql` (`scheduler_leases`, `trigger_firings`)<br/>`packages/gateway/src/modules/watcher/scheduler.ts` (DB lease + firing_id claim)<br/>`packages/gateway/src/modules/channels/worker.ts` (DB lease for channel worker) | Watcher scheduler persists `firing_id` and uses `ON CONFLICT DO NOTHING` to dedupe firings. |

## 7) Gap Cards

### GAP-f1f7f78d (ARI-08c4e108) — Provenance tagging end-to-end (resolved)

- Summary: Provenance tags are now propagated from ingress into agent turns and promoted across tool calls; policy evaluation and approvals receive provenance context; non-user/system sources are wrapped as DATA for injection defense.
- Why it matters: Provenance-aware policy and DATA-tag injection defense are enforcement layers (not prompt-only) for untrusted inputs.
- Evidence: See Traceability row `ARI-08c4e108` (`packages/gateway/src/modules/agent/runtime.ts`, `packages/gateway/src/modules/agent/tool-executor.ts`, `packages/gateway/src/modules/channels/worker.ts`, `packages/schemas/src/agent.ts`; tests: `packages/gateway/tests/integration/tool-loop.test.ts`, `packages/gateway/tests/integration/telegram-e2e.test.ts`).
- Resolution: Agent turns accept `metadata.provenance_sources` and return `provenance_sources` that include promoted sources like `tool`/`web` when tool output enters context; outbound channel-send policy uses the derived provenance set.
- Risk level: Medium (provenance propagation can tighten approvals when provenance rules are configured).
- Validation: `pnpm typecheck` + `pnpm test` + `pnpm lint` (all passing).
- Rollback plan: Revert provenance propagation changes; missing provenance still fails closed (`require_approval`) when provenance rules are configured.

### GAP-1d667109 (ARI-5772b95c) — Artifact metadata + gateway fetch route (resolved)

- Summary: Artifact metadata is now persisted durably in the StateStore, and artifact bytes can be fetched through the gateway via authenticated HTTP routes.
- Why it matters: Provides the stable metadata index needed for authorization hooks, auditability, retention, and export, while keeping raw bytes in the pluggable ArtifactStore.
- Evidence: See Traceability row `ARI-5772b95c` (migrations + `ArtifactDal` + engine persistence + fetch route + tests).
- Resolution: Added `artifacts` table (sqlite+postgres), persisted metadata on attempt completion, and added `GET /artifact/:artifactId` (bytes) + `/meta` (metadata).
- Risk level: Medium (new DB table + API surface).
- Validation: Unit test in `packages/gateway/tests/unit/execution-engine.test.ts` and integration test in `packages/gateway/tests/integration/artifact-fetch.test.ts`; full `pnpm test` and `pnpm lint` passing.
- Rollback plan: Migration is additive; revert persistence + route changes while keeping legacy `execution_attempts.artifacts_json` intact.

### GAP-09465ece (ARI-77a5cb85) — Multi-agent isolation for sessions + memory (resolved)

- Summary: Durable memory tables are now keyed by `agent_id`, and memory/session access paths are agent-scoped by construction (agent-namespaced session ids + agent-scoped DAL queries).
- Why it matters: Prevents cross-agent state bleed and makes “multiple agents behind one gateway” a real isolation boundary instead of a naming convention.
- Evidence: See Traceability row `ARI-77a5cb85` (memory migrations + agent-scoped DAL/route wiring).
- Resolution:
  - Added `agent_id` columns + scoped uniqueness to memory tables (sqlite+postgres migration `013_agent_scope_memory.sql`).
  - Updated memory/vector DALs to require `agentId` and updated agent runtime + channel worker wiring accordingly.
  - Updated memory HTTP route queries to scope by `agent_id` (query/header/env default).
- Risk level: Medium/High (schema + query changes), mitigated by tests.
- Validation: `pnpm typecheck && pnpm test && pnpm lint` all passing; memory scoping regression in `packages/gateway/tests/integration/memory.test.ts`.
- Rollback plan: Migrations are additive; revert query enforcement and continue using default agent scoping.

### GAP-51a1363e (ARI-7d56f36b) — Event at-least-once + dedupe (resolved)

- Summary: Durable at-least-once edge consumption is enforced via the outbox cursor, and `@tyrum/client` now dedupes by `event_id` (bounded, in-memory) to tolerate duplicates.
- Why it matters: UIs/clients need reliable event streams; at-least-once + dedupe is the core reliability contract.
- Evidence: See Traceability row `ARI-7d56f36b` (`packages/gateway/src/modules/backplane/outbox-poller.ts`, `packages/client/src/ws-client.ts`).
- Resolution (this run): Client dedupe + tests; outbox poller semantics hardened.
- Risk level: Low/Medium.
- Validation: `pnpm typecheck && pnpm test && pnpm lint` (all passing).
- Rollback plan: Revert the `@tyrum/client` dedupe change (and/or outbox poller change) and re-run validations.

### GAP-84ea1396 (ARI-bed2870e) — Outbox at-least-once semantics (resolved)

- Summary: Previously, the consumer cursor advanced even when delivery threw, which could drop messages. OutboxPoller now acks after processing and does not advance cursors on unexpected delivery failures.
- Why it matters: Clustered deployments rely on the StateStore outbox as the durability layer for cross-edge commands/events.
- Evidence: See Traceability row `ARI-bed2870e` (`packages/gateway/src/modules/backplane/outbox-poller.ts`, `packages/gateway/tests/unit/outbox-poller.test.ts`).
- Root cause hypothesis: The poller was originally optimized to never wedge consumers, at the cost of silent drops.
- Resolution (this run): Ack-after-processing semantics + unit coverage; send failures are handled best-effort per connection without throwing.
- Risk level: Low/Medium.
- Validation: `pnpm typecheck && pnpm test && pnpm lint` (all passing).
- Rollout plan: Standard deploy; change is localized to outbox poller behavior.
- Rollback plan: Revert outbox poller changes and re-run validations.

### GAP-689f289c (ARI-878e8a8e) — “Approve always” / durable policy overrides (resolved)

- Summary: Approvals now support `mode=once|always`; approve-always creates a durable, revocable policy override and records the applied `policy_override_id` on the approval resolution for auditability.
- Why it matters: Reduces operator friction while preserving conservative safety semantics (tight scope, auditable, revocable).
- Evidence: See Traceability row `ARI-878e8a8e` (schema + migrations + apply path + UI + revoke route).
- Resolution: Added policy override persistence + operator UI and API surfaces; approvals can create overrides atomically during resolution.
- Risk level: High (security-sensitive), mitigated by conservative semantics + revoke.
- Validation: `packages/gateway/tests/unit/approval-approve-always.test.ts` + full `pnpm test`.
- Rollback plan: Revert the override + approval changes; overrides remain additive data in the DB.

### GAP-61ad5e4c (ARI-8b1efb1c) — Policy override evaluation semantics (resolved)

- Summary: Policy override application now follows the documented lattice: never bypass `deny`; only relax `require_approval → allow` when the override matches the tool/action match target.
- Why it matters: Prevents silent security bypasses while still enabling safe “approve always”.
- Evidence: See Traceability row `ARI-8b1efb1c` (`packages/gateway/src/modules/policy-bundle/service.ts`, `packages/gateway/tests/unit/policy-bundle-service.test.ts`).
- Resolution: Introduced durable overrides + matching and applied them only to `require_approval` decisions.
- Risk level: High, mitigated by explicit tests and deny-sticky behavior.
- Validation: Unit coverage in `packages/gateway/tests/unit/policy-bundle-service.test.ts` + full `pnpm test`.
- Rollback plan: Revert override application; approvals fall back to require-once.

### GAP-56e29bd0 (ARI-d0e169d0) — suggested_overrides on tool approvals (resolved)

- Summary: Tool-policy approvals now include a bounded `suggested_overrides` list and the UI supports selecting one during approve-always resolution.
- Why it matters: Encourages conservative, tool-scoped overrides and reduces operator error.
- Evidence: See Traceability row `ARI-d0e169d0` (`packages/schemas/src/approval.ts`, `packages/gateway/src/modules/policy-overrides/match-target.ts`, `packages/gateway/src/modules/agent/runtime.ts`, `packages/gateway/src/routes/web-ui.ts`).
- Resolution: Added schemas + suggestion generation and surfaced in approval context/UI.
- Risk level: Medium (UX and suggestion quality), mitigated by tight caps and conservative patterns.
- Validation: Full `pnpm test`.
- Rollback plan: Stop populating suggestions and keep the schema field optional.

### GAP-0af53ac4 (ARI-9c8232b4) — Model fallback chain + auth rotation (resolved)

- Summary: The model proxy now rotates auth profiles on retryable failures and falls back to the next model in an explicit `fallback_chain`.
- Why it matters: Improves availability under transient failures/rate limits without requiring operator intervention.
- Evidence: See Traceability row `ARI-9c8232b4` (`packages/gateway/src/routes/model-proxy.ts`, `packages/gateway/src/modules/auth-profiles/service.ts`, `packages/gateway/tests/unit/model-proxy.test.ts`).
- Resolution: Implemented a retry loop in the model proxy: rotate DB-backed auth profiles first; on retryable failure, try the next model candidate.
- Risk level: Medium (behavior changes on failures).
- Validation: Unit coverage in `packages/gateway/tests/unit/model-proxy.test.ts`; full `pnpm test` passing.
- Rollback plan: Revert model proxy fallback loop (config remains backward-compatible; default chain empty).

### GAP-7a2a473f (ARI-ded1b7fa) — Provider usage polling (resolved)

- Summary: `/usage` now supports best-effort provider polling when enabled; results are cached/rate-limited, non-fatal, and policy-checked.
- Why it matters: Operators need quota visibility without destabilizing the gateway or treating provider APIs as authoritative billing.
- Evidence: See Traceability row `ARI-ded1b7fa` (`packages/gateway/src/routes/usage.ts`, `packages/gateway/src/modules/observability/provider-usage.ts`, `packages/gateway/tests/unit/usage-route.test.ts`).
- Resolution: Added `ProviderUsageService` that polls configured provider usage endpoints using active auth (prefers DB auth profiles when session headers are present), gated by `TYRUM_PROVIDER_USAGE_POLLING=1`.
- Risk level: Low/Medium (new outbound HTTP path).
- Validation: Unit tests + full `pnpm test` passing.
- Rollback plan: Unset `TYRUM_PROVIDER_USAGE_POLLING` (provider polling becomes `status=disabled`; local accounting unchanged).

### GAP-eb1f2f5e (ARI-e49fa872) — Queue modes + overflow handling (resolved)

- Summary: Channel ingress now applies explicit queue modes (`collect|followup|steer|steer_backlog|interrupt`) and bounded overflow policies (`drop_oldest|drop_newest|summarize_dropped`) with observable drop events.
- Why it matters: Keeps inbound bursts bounded and predictable, and makes drop/overflow behavior visible to operators.
- Evidence: See Traceability row `ARI-e49fa872` (`packages/gateway/src/modules/channels/worker.ts`, `packages/gateway/src/modules/channels/inbox-dal.ts`, `packages/gateway/tests/unit/channel-queue.test.ts`).
- Resolution:
  - `ChannelInboxDal.enqueueMessage(...)` supports overflow policies and synthesizes summaries for `summarize_dropped`.
  - `ChannelWorker` applies queue modes when multiple pending inbound messages exist for a container; emits episodic events (`channel_inbound_overflow`, `channel_inbound_queue_drop`).
- Risk level: Medium (drop semantics + multi-turn behavior).
- Validation: Unit coverage in `packages/gateway/tests/unit/channel-queue.test.ts`; Telegram E2E still passing.
- Rollback plan: Revert channel worker queue changes and keep cap/overflow defaults (`collect` + `drop_oldest`).

### GAP-241c37b8 (ARI-e6ac01f2) — `?` wildcard support (resolved)

- Summary: Wildcard patterns supported `*` only; `?` now matches exactly one character.
- Why it matters: Required for policy override pattern language and conservative matching semantics.
- Resolution: Implemented in `packages/gateway/src/modules/policy-bundle/evaluate.ts` with unit coverage in `packages/gateway/tests/unit/policy-bundle-service.test.ts`.
- Risk level: Low.
- Validation: `pnpm typecheck && pnpm test && pnpm lint` (all passing).
- Rollback plan: Revert the matcher change and re-run validations.

## 8) Proposed Plan

### Phased roadmap

- Phase 0 — Foundations (low-risk, unblockers): PLAN-1dfd5021 ✅, PLAN-afa8916b ✅, PLAN-66147833 ✅
- Phase 1 — Security alignment: PLAN-912486d7 ✅, PLAN-83cbd7a5 ✅, PLAN-d6af6ee3 ✅, PLAN-f75ba306 ✅, PLAN-ad74615d ✅
- Phase 2 — Core migrations & operability: PLAN-1f662dcc ✅, PLAN-7633ec69 ✅, PLAN-bf69726d ✅, PLAN-ae0cedb5 ✅
- Phase 3 — Cleanup & deprecations: none currently planned (future deprecations TBD)

### PLAN items (ticket-level)

#### PLAN-1dfd5021 — Support ? wildcard in policy globs

- GAP: GAP-241c37b8 (ARI-e6ac01f2)
- Status: Completed (2026-02-21)
- Areas: `packages/gateway/src/modules/policy-bundle/evaluate.ts`, `packages/gateway/tests/unit/policy-bundle-service.test.ts`
- Acceptance criteria: `?` matches exactly one char; `*` remains zero-or-more; unit tests cover tool and host matching.
- Rollout/rollback: Standard deploy; rollback by reverting matcher + tests.
- Risk: Low.

#### PLAN-afa8916b — Fix outbox poller at-least-once semantics

- GAP: GAP-84ea1396 (ARI-bed2870e); also materially improves GAP-51a1363e (ARI-7d56f36b)
- Status: Completed (2026-02-21)
- Areas: `packages/gateway/src/modules/backplane/outbox-poller.ts`, `packages/gateway/src/index.ts`, `packages/gateway/tests/unit/outbox-poller.test.ts`
- Acceptance criteria:
  - Outbox consumer cursor advances only after processing each row (ack-after-processing).
  - Unexpected delivery failures do not advance the cursor (retry on next tick), preserving at-least-once semantics at the edge boundary.
  - Unit tests cover cursor advancement and “no ack on throw”.
- Tests/verification: `packages/gateway/tests/unit/outbox-poller.test.ts` + full `pnpm test`.
- Rollout: Standard deploy.
- Rollback: Revert outbox poller changes and re-run validations.
- Risk: Medium (clustered WS routing path).
- Dependencies: None.

#### PLAN-66147833 — Harden event delivery and dedupe by event_id

- GAP: GAP-51a1363e (ARI-7d56f36b)
- Status: Completed (2026-02-21)
- Areas: `packages/client/src/ws-client.ts`, `packages/client/tests/ws-client.test.ts`
- Acceptance criteria:
  - Consumers can dedupe events by `event_id` (bounded).
  - Unit tests demonstrate duplicate suppression.
- Approach: add bounded in-memory dedupe in `@tyrum/client` before emitting events; add unit coverage.
- Tests/verification: unit tests + full `pnpm test`.
- Rollout/rollback: additive; rollback by reverting the client dedupe change.
- Risk: Low/Medium.
- Dependencies: Best done alongside PLAN-afa8916b (done).

#### PLAN-912486d7 — Implement policy overrides (storage + evaluation)

- GAP: GAP-61ad5e4c (ARI-8b1efb1c)
- Status: Completed (2026-02-21)
- Areas: migrations (sqlite+postgres), `packages/gateway/src/modules/policy-overrides/*`, `packages/gateway/src/modules/policy-bundle/service.ts`, `packages/gateway/src/routes/policy-overrides.ts`, `packages/schemas/src/policy-overrides.ts`
- Acceptance criteria:
  - Overrides never bypass explicit `deny`.
  - Overrides only relax `require_approval` → `allow`.
  - Overrides are auditable and revocable (at least via API).
- Tests/verification: unit tests for override matching + decision lattice; full `pnpm test`.
- Rollout: standard deploy (additive schema).
- Rollback: revert override application; keep additive override table data.
- Risk: High.
- Dependencies: Uses wildcard matcher (PLAN-1dfd5021 done).

#### PLAN-83cbd7a5 — Support approve-always approvals

- GAP: GAP-689f289c (ARI-878e8a8e)
- Status: Completed (2026-02-21)
- Areas: `packages/schemas/src/approval.ts`, `packages/gateway/src/modules/approval/*`, `packages/gateway/src/ws/protocol.ts`, `packages/gateway/src/routes/approval.ts`, `packages/gateway/src/routes/web-ui.ts`
- Acceptance criteria:
  - Approval resolution can create a durable override on “approve always”.
  - Overrides are revocable and audited.
  - “Approve once” behavior remains unchanged.
- Tests/verification: unit tests for approve-always resolution; full `pnpm test`.
- Rollout: standard deploy; operator can revoke overrides.
- Rollback: revert approve-always plumbing and/or revoke/ignore overrides.
- Risk: High.
- Dependencies: PLAN-912486d7.

#### PLAN-d6af6ee3 — Add suggested_overrides to approvals

- GAP: GAP-56e29bd0 (ARI-d0e169d0)
- Status: Completed (2026-02-21)
- Areas: `packages/schemas/src/approval.ts`, `packages/gateway/src/modules/policy-overrides/match-target.ts`, `packages/gateway/src/modules/agent/runtime.ts`, `packages/gateway/src/routes/web-ui.ts`
- Acceptance criteria:
  - Approvals optionally include `suggested_overrides` (bounded length).
  - Suggestions are conservative and deny-aware.
- Tests/verification: schema tests + full `pnpm test`.
- Rollout/rollback: field is optional; stop populating to roll back UX while preserving compatibility.
- Risk: Medium.
- Dependencies: Best after PLAN-912486d7, but can ship as informational first.

#### PLAN-f75ba306 — Enforce per-agent isolation in StateStore queries

- GAP: GAP-09465ece (ARI-77a5cb85)
- Status: Completed (2026-02-21)
- Areas: migrations + DALs across gateway (sessions, memory, artifacts, approvals, execution)
- Acceptance criteria:
  - Every durable record has an agent ownership key; cross-agent reads/writes are denied by default.
  - Regression tests demonstrate isolation.
- Approach: add agent_id columns (expand) → backfill → query enforcement → constraints (contract).
- Tests/verification: new unit/integration tests for isolation.
- Rollout: staged migrations; feature flag enforcement if needed.
- Rollback: revert enforcement first; keep additive columns.
- Risk: High.
- Dependencies: Should precede or be done alongside artifact catalog and policy override storage.

#### PLAN-ad74615d — Propagate provenance tags end-to-end

- GAP: GAP-f1f7f78d (ARI-08c4e108)
- Status: Completed (2026-02-21)
- Areas: `packages/gateway/src/modules/agent/runtime.ts`, `packages/gateway/src/modules/agent/tool-executor.ts`, `packages/gateway/src/modules/channels/worker.ts`, `packages/schemas/src/agent.ts`
- Acceptance criteria: All externally sourced inputs have provenance tags and reach policy evaluation; missing provenance remains conservative.
- Tests/verification: integration coverage added; full `pnpm test`.
- Rollout/rollback: conservative defaults already; rollback by reverting propagation code.
- Risk: Medium.
- Dependencies: Complements PLAN-f75ba306.

#### PLAN-1f662dcc — Persist artifact metadata and add fetch route

- GAP: GAP-1d667109 (ARI-5772b95c)
- Status: Completed (2026-02-21)
- Areas: migrations (sqlite+postgres), `packages/gateway/src/modules/artifact/dal.ts`, `packages/gateway/src/modules/execution/engine.ts`, `packages/gateway/src/routes/artifacts.ts`, tests
- Acceptance criteria: artifact metadata persisted durably; authorized gateway endpoint streams bytes; denial cases tested.
- Tests/verification: unit + integration tests; full `pnpm test`.
- Rollout: additive schema; standard deploy.
- Rollback: revert persistence + route changes; keep additive schema and legacy `execution_attempts.artifacts_json`.
- Risk: Medium.
- Dependencies: Complements PLAN-f75ba306 (fine-grained authorization/scoping follow-ups).

#### PLAN-7633ec69 — Implement model fallback chain

- GAP: GAP-0af53ac4 (ARI-9c8232b4)
- Status: Completed (2026-02-21)
- Areas: `packages/gateway/src/routes/model-proxy.ts`, `packages/gateway/src/modules/auth-profiles/service.ts`, tests
- Acceptance criteria: rotate auth profiles on retryable failures; fall back to next model after exhaustion; observable events/logs.
- Approach: add failure classification + retry loop + fallback chain; keep current behavior as default unless configured.
- Tests/verification: unit tests for sequencing; integration tests with stubs.
- Rollout: config/feature-flagged.
- Rollback: disable config; revert to single-model behavior.
- Risk: Medium.
- Dependencies: None.

#### PLAN-bf69726d — Implement provider usage polling

- GAP: GAP-7a2a473f (ARI-ded1b7fa)
- Status: Completed (2026-02-21)
- Areas: `packages/gateway/src/modules/observability/provider-usage.ts`, `packages/gateway/src/routes/usage.ts`, tests
- Acceptance criteria: polling is cache-backed, rate-limited, non-fatal, policy-respecting; `/usage` reflects status.
- Approach: add poller behind config; cache in DB or memory with TTL; handle provider errors gracefully.
- Tests/verification: unit tests for caching and error handling.
- Rollout: config-gated; default off.
- Rollback: disable config.
- Risk: Low/Medium.
- Dependencies: None.

#### PLAN-ae0cedb5 — Implement queue modes for active runs

- GAP: GAP-eb1f2f5e (ARI-e49fa872)
- Status: Completed (2026-02-21)
- Areas: `packages/gateway/src/modules/channels/inbox-dal.ts`, `packages/gateway/src/modules/channels/worker.ts`, tests
- Acceptance criteria: at least `collect`/`followup` modes with bounded backlog + observable overflow; modes are durable per (session_key,lane).
- Approach: implement minimal modes first behind feature flag; expand to steer/interrupt after validation.
- Tests/verification: integration tests for bursty ingress + overflow events.
- Rollout: feature-flagged; default off.
- Rollback: disable feature flag; keep backlog table additive.
- Risk: High.
- Dependencies: PLAN-f75ba306.

### Recommended PR breakdown (to minimize risk)

- PR 1: PLAN-1dfd5021 (done) — wildcard `?` matcher + tests.
- PR 2: PLAN-afa8916b (done) — durable outbox delivery semantics.
- PR 3: PLAN-66147833 (done) — client-side event dedupe by `event_id`.
- PR 4: PLAN-912486d7 (done) — policy overrides storage + evaluator.
- PR 5: PLAN-83cbd7a5 + PLAN-d6af6ee3 (done) — approve-always + suggested overrides + operator surfaces.
- PR 6: PLAN-ad74615d (done) — provenance propagation end-to-end.
- PR 7: PLAN-f75ba306 (done) — agent isolation enforcement.
- PR 8: PLAN-1f662dcc (done) — artifacts metadata + fetch routes.
- PR 9: PLAN-7633ec69 (done) — model fallback chain + auth rotation.
- PR 10: PLAN-bf69726d (done) — provider usage polling.
- PR 11: PLAN-ae0cedb5 (done) — queue modes + overflow policies.

## 9) Implementation journal (this run)

### PLAN-912486d7 (GAP-61ad5e4c / ARI-8b1efb1c) — Completed

- Change: Added durable policy overrides with conservative semantics (never bypass `deny`; only relax `require_approval → allow`) plus operator list/revoke surfaces.
- Code changes:
  - Migrations: `packages/gateway/migrations/sqlite/011_policy_overrides.sql`, `packages/gateway/migrations/postgres/011_policy_overrides.sql`
  - DAL + matching: `packages/gateway/src/modules/policy-overrides/*`
  - Application: `packages/gateway/src/modules/policy-bundle/service.ts`
  - HTTP routes: `packages/gateway/src/routes/policy-overrides.ts`

### PLAN-83cbd7a5 (GAP-689f289c / ARI-878e8a8e) — Completed

- Change: Approvals now support approve-once vs approve-always; approve-always creates a durable policy override and records the `policy_override_id` on the approval resolution for auditability.
- Code changes:
  - Schema + protocol events: `packages/schemas/src/approval.ts`, `packages/schemas/src/policy-overrides.ts`, `packages/schemas/src/protocol.ts`
  - Apply path: `packages/gateway/src/modules/approval/apply.ts`
  - HTTP/WS/UI: `packages/gateway/src/routes/approval.ts`, `packages/gateway/src/ws/protocol.ts`, `packages/gateway/src/routes/web-ui.ts`
  - Unit tests: `packages/gateway/tests/unit/approval-approve-always.test.ts`

### PLAN-d6af6ee3 (GAP-56e29bd0 / ARI-d0e169d0) — Completed

- Change: Tool-policy approvals now include a bounded `suggested_overrides` list; approve-always UX supports selecting one.
- Code changes:
  - Suggestion generation: `packages/gateway/src/modules/policy-overrides/match-target.ts`
  - Approval creation: `packages/gateway/src/modules/agent/runtime.ts`
  - UI rendering: `packages/gateway/src/routes/web-ui.ts`

### PLAN-ad74615d (GAP-f1f7f78d / ARI-08c4e108) — Completed

- Change: Provenance tags now propagate into agent turns, are promoted across tool calls (e.g. adding `tool`/`web` when tool output enters context), and are used for outbound action policy decisions.
- Code changes:
  - Agent turn provenance: `packages/gateway/src/modules/agent/runtime.ts`, `packages/schemas/src/agent.ts`
  - Channel worker plumbing: `packages/gateway/src/modules/channels/worker.ts`
  - Integration tests: `packages/gateway/tests/integration/tool-loop.test.ts`, `packages/gateway/tests/integration/telegram-e2e.test.ts`

### PLAN-1f662dcc (GAP-1d667109 / ARI-5772b95c) — Completed

- Change: Artifact metadata is now persisted durably in the StateStore and artifact bytes are fetched through the gateway via authenticated HTTP routes.
- Code changes:
  - Migrations: `packages/gateway/migrations/sqlite/012_artifacts.sql`, `packages/gateway/migrations/postgres/012_artifacts.sql`
  - Metadata DAL: `packages/gateway/src/modules/artifact/dal.ts`
  - Persistence hook: `packages/gateway/src/modules/execution/engine.ts`
  - Fetch routes: `packages/gateway/src/routes/artifacts.ts`
  - Tests: `packages/gateway/tests/unit/execution-engine.test.ts`, `packages/gateway/tests/integration/artifact-fetch.test.ts`

### PLAN-f75ba306 (GAP-09465ece / ARI-77a5cb85) — Completed

- Change: Durable memory and session data is now agent-scoped by construction (agent-scoped homes, agent-namespaced session ids, and `agent_id`-scoped DB queries).
- Code changes:
  - Migrations: `packages/gateway/migrations/sqlite/013_agent_scope_memory.sql`, `packages/gateway/migrations/postgres/013_agent_scope_memory.sql`
  - Agent runtime + home: `packages/gateway/src/modules/agent/home.ts`, `packages/gateway/src/modules/agent/session-dal.ts`
  - Memory DALs + routes: `packages/gateway/src/modules/memory/dal.ts`, `packages/gateway/src/modules/memory/vector-dal.ts`, `packages/gateway/src/routes/memory.ts`
  - Tests: `packages/gateway/tests/integration/memory.test.ts`

### PLAN-7633ec69 (GAP-0af53ac4 / ARI-9c8232b4) — Completed

- Change: Model proxy now supports explicit fallback chains and rotates auth profiles on retryable failures.
- Code changes:
  - Model proxy: `packages/gateway/src/routes/model-proxy.ts`
  - Auth rotation: `packages/gateway/src/modules/auth-profiles/service.ts`
  - Tests: `packages/gateway/tests/unit/model-proxy.test.ts`, `packages/gateway/tests/unit/auth-profiles.test.ts`

### PLAN-bf69726d (GAP-7a2a473f / ARI-ded1b7fa) — Completed

- Change: `/usage` supports optional, policy-checked provider usage polling (cached, rate-limited, non-fatal).
- Code changes:
  - Poller: `packages/gateway/src/modules/observability/provider-usage.ts`
  - Route: `packages/gateway/src/routes/usage.ts`
  - Tests: `packages/gateway/tests/unit/usage-route.test.ts`

### PLAN-ae0cedb5 (GAP-eb1f2f5e / ARI-e49fa872) — Completed

- Change: Channel ingress applies explicit queue modes (`collect|followup|steer|steer_backlog|interrupt`) and bounded overflow policies, emitting episodic drop/overflow events.
- Code changes:
  - Inbox DAL: `packages/gateway/src/modules/channels/inbox-dal.ts`
  - Queueing behavior: `packages/gateway/src/modules/channels/worker.ts`
  - Tests: `packages/gateway/tests/unit/channel-queue.test.ts`

### Test fallout and cleanup

- Updated tests for agent-scoped homes (`TYRUM_HOME/agents/<agent_id>`) and the `SessionDal.getOrCreate(agentId, ...)` signature:
  - `packages/gateway/tests/integration/agent.test.ts`
  - `packages/gateway/tests/unit/session-dal.test.ts`
- Fixed model proxy test setup to include `fallbackChain` in the state shape:
  - `packages/gateway/tests/unit/auth-profiles.test.ts`
- Fixed oxlint warnings in approval web UI templates: `packages/gateway/src/routes/web-ui.ts`
- Commands run:
  - `pnpm typecheck` → exit 0
  - `pnpm vitest run packages/gateway/tests/unit/usage-route.test.ts packages/gateway/tests/unit/channel-queue.test.ts` → exit 0
  - `pnpm test` → exit 1 (1 failed: `packages/gateway/tests/unit/auth-profiles.test.ts` missing `fallbackChain` in test state)
  - `pnpm vitest run packages/gateway/tests/unit/auth-profiles.test.ts -t "integrates with model proxy"` → exit 0
  - `pnpm test` → exit 0 (1035 passed, 1 skipped)
  - `pnpm lint` → exit 0 (0 warnings/errors)

### Finalization (2026-02-21T17:00:55Z)

- Committed implementation: `1a826cb` (feat: close architecture gaps).
- Baseline validations at HEAD `1a826cb`: `pnpm typecheck` → exit 0; `pnpm test` → exit 0 (1035 passed, 1 skipped); `pnpm lint` → exit 0.
- Updated durable docs: `docs/architecture-gap-closure/STATE.md`, `docs/architecture-gap-closure/REPORT.md`, `docs/architecture-gap-closure/LOG.md`.

## 10) Risks, mitigations, rollback overview

- **Policy overrides + approve-always:** High risk (security-sensitive); mitigated by deny-sticky semantics, narrow scoping, auditability, and revoke; rollback by reverting override application and approval plumbing.
- **Provenance propagation:** Medium risk (may tighten approvals when provenance rules are configured); mitigated by conservative defaults and test coverage; rollback by reverting provenance promotion/plumbing.
- **Agent home + session id namespacing:** Medium risk (changes on-disk paths and durable ids); mitigated by “product not in use yet” posture + tests; rollback by reverting `resolveAgentHome`/SessionDal changes.
- **Outbox cursor semantics:** Medium risk (clustered WS routing); mitigated by unit tests + full validation; rollback by reverting `packages/gateway/src/modules/backplane/outbox-poller.ts`.
- **Provider usage polling:** Low/Medium risk (new outbound HTTP path); mitigated by default-off gating + caching + policy checks; rollback by unsetting `TYRUM_PROVIDER_USAGE_POLLING`.
- **Channel queue modes + overflow policies:** Medium risk (drop semantics + multi-turn behavior); mitigated by bounded queue + explicit mode selection + unit coverage; rollback by reverting channel worker behavior or setting `TYRUM_CHANNEL_QUEUE_MODE=collect`.

## 11) Open questions / unverifiable items

- Confirm intended fine-grained artifact authorization semantics (policy snapshot / sensitivity / agent scoping) beyond the current “admin token required” baseline.
- Decide whether additional provenance tagging is desired for multi-user channel connectors beyond `sender_id` + `provenance_sources` (e.g., treating all connector input as untrusted DATA vs user intent).

## 12) Appendix: commands run + key outputs

- `pnpm typecheck` → exit 0
- `pnpm vitest run packages/gateway/tests/unit/usage-route.test.ts packages/gateway/tests/unit/channel-queue.test.ts` → exit 0
- `pnpm test` → exit 0 (1035 passed, 1 skipped)
- `pnpm lint` → exit 0 (0 warnings/errors)
