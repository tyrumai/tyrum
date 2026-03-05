# API Reference

This document is a hand-maintained API reference for the Tyrum Gateway HTTP and WebSocket APIs.

This is a manually written first version; **future automation** may generate this document (or an OpenAPI/JSON Schema equivalent) from `packages/gateway/src/routes/*` and `@tyrum/schemas`.

## Table of Contents

- [Conventions](#conventions)
- [Authentication & Authorization](#authentication--authorization)
- [HTTP API](#http-api)
- [WebSocket API](#websocket-api)

## Conventions

- Base URL: `http(s)://<gateway-host>:<port>`
- All JSON requests/responses use `Content-Type: application/json` unless noted.
- Most error responses are JSON shaped like:
  - `{ "error": "<code>", "message": "<human-readable message>" }`
- When enabled, the gateway returns a stable `x-request-id` response header.

## Authentication & Authorization

### HTTP auth

When gateway auth is enabled (default for most deployments), requests are authenticated via:

- `Authorization: Bearer <token>` (preferred)
- Cookie `tyrum_admin_token=<token>` (primarily for browser `/ui` usage)

**Public allowlist (no token required):**

- `GET /healthz`
- `GET /ui` and `GET /ui/*`
- `POST /auth/session` and `POST /auth/logout`
- `GET /providers/:provider/oauth/callback` (OAuth callback; state/PKCE protected)

### Token types

- **Admin token**: Break-glass; bypasses scope enforcement.
- **Device token**: Scoped; per-request scope enforcement applies (HTTP + WS).

### HTTP scopes (device tokens)

For device tokens, HTTP routes are scope-checked based on method + path template:

- Admin surfaces (examples: `/policy/*`, `/secrets/*`, `/snapshot/*`, `/routing/*`, `/providers/*`) require `operator.admin`.
- `/approvals/*` requires `operator.approvals`.
- `/pairings/*` requires `operator.pairing`.
- Most operator surfaces default to:
  - `GET` → `operator.read`
  - `POST|PUT|PATCH|DELETE` → `operator.write`

If a route is not in the authorization matrix, device tokens are **forbidden** (deny-by-default).

### WebSocket scopes (device tokens)

For device tokens, each WS request `type` is scope-checked via `packages/gateway/src/modules/authz/ws-scope-matrix.ts`.

## HTTP API

### Public endpoints

#### GET /healthz

- Auth: Public
- Request: None
- Response:
  - `200` JSON `{ status: "ok", is_exposed: boolean }`

#### GET /ui

- Auth: Public
- Request: None
- Response:
  - `200` HTML (operator SPA shell)
  - `404` text `operator_ui_assets_unavailable` (if UI assets are missing)

#### GET /ui/\*

- Auth: Public
- Request: Path tail (static asset or SPA route)
- Response:
  - `200` HTML (SPA routes) or bytes (static assets)
  - `404` text `not_found`

#### POST /auth/session

- Auth: Public (bootstrap endpoint)
- Availability: Only when gateway auth is enabled (TokenStore is wired)
- Request: JSON `{ token: string }`
- Response:
  - `204` (sets `tyrum_admin_token` httpOnly cookie)
  - `400` invalid JSON / missing token
  - `401` invalid token

#### POST /auth/logout

- Auth: Public
- Availability: Only when gateway auth is enabled (TokenStore is wired)
- Request: None
- Response:
  - `204` (clears `tyrum_admin_token` cookie)

#### GET /providers/:provider/oauth/callback

- Auth: Public
- Purpose: OAuth authorization-code callback (PKCE + state)
- Request: Query params include `state`, `code` (or `error`, `error_description`)
- Response:
  - `200` HTML success/failure page
  - `400` for invalid/expired state, missing params, etc.

### Runtime & diagnostics

#### GET /status

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: None
- Response:
  - `200` JSON runtime details (`version`, `instance_id`, `role`, `db_kind`, `ws`, `policy`, etc.)
  - `401` missing/invalid token
  - `403` insufficient scope (device tokens)

#### GET /metrics

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: None
- Response:
  - `200` Prometheus text format (content-type set by registry)
  - `401`, `403`

#### GET /connections

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: None
- Response:
  - `200` JSON WebSocket connection stats (from `ConnectionManager.getStats()`)
  - `401`, `403`

#### GET /presence

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: None
- Response:
  - `200` JSON `{ status: "ok", generated_at, entries: [...] }`
  - `401`, `403`

### Contracts (JSON Schema)

#### GET /contracts/jsonschema/catalog.json

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: None
- Response:
  - `200` JSON schema catalog
  - `500` `{ error: "contracts_unavailable", ... }` when schemas are not available
  - `401`, `403`

#### GET /contracts/jsonschema/:file

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: `:file` must be a safe `*.json` filename (no paths); `catalog.json` is not served here
- Response:
  - `200` JSON schema file contents
  - `404` `{ error: "not_found", ... }` (missing/invalid filename)
  - `500` `{ error: "contracts_unavailable", ... }`
  - `401`, `403`

### Usage

#### GET /usage

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: Optional query params (mutually exclusive): `run_id`, `key`, `agent_key`
- Response:
  - `200` JSON usage totals (local DB) + optional provider polling status
  - `400` for invalid scope param combinations
  - `401`, `403`

### Policy

#### POST /policy/check

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: JSON `PolicyCheckRequest` (`@tyrum/schemas`)
- Response:
  - `200` JSON `PolicyDecision` (`@tyrum/schemas`)
  - `400` invalid request
  - `401`, `403`

#### GET /policy/bundle

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: None
- Response:
  - `200` JSON `{ status: "ok", generated_at, effective: { sha256, bundle, sources } }`
  - `401`, `403`

#### GET /policy/overrides

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: Query params (validated by `PolicyOverrideListRequest`): `agent_id`, `tool_id`, `status`, `limit`, `cursor`
- Response:
  - `200` JSON `PolicyOverrideListResponse`
  - `400` invalid request
  - `401`, `403`

#### POST /policy/overrides

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: JSON `PolicyOverrideCreateRequest`
- Response:
  - `201` JSON `PolicyOverrideCreateResponse`
  - `400` invalid request
  - `401`, `403`

#### POST /policy/overrides/revoke

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: JSON `PolicyOverrideRevokeRequest`
- Response:
  - `200` JSON `PolicyOverrideRevokeResponse`
  - `404` override not found / not active
  - `400`, `401`, `403`

### Approvals

#### GET /approvals

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.approvals`
- Request: Optional query param `status` (`pending|approved|denied|expired|cancelled`)
- Response:
  - `200` JSON `{ approvals: [...] }`
  - `400` invalid status
  - `401`, `403`

#### GET /approvals/:id

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.approvals`
- Request: `:id` UUID
- Response:
  - `200` JSON `{ approval: ... }`
  - `400` invalid id
  - `404` not found
  - `401`, `403`

#### POST /approvals/:id/respond

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.approvals`
- Request: JSON `{ decision: "approved" | "denied", reason?: string, mode?: "once"|"always", overrides?: [...] }`
- Response:
  - `200` JSON `{ approval: ..., created_overrides?: [...] }` (idempotent if already resolved)
  - `400` invalid request
  - `404` not found
  - `401`, `403`

#### GET /approvals/:id/preview

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.approvals`
- Request: `:id` UUID
- Response:
  - `200` JSON `{ id, plan_id, step_index, prompt, context, status, expires_at }`
  - `400` invalid id
  - `404` not found
  - `401`, `403`

### Pairing (node enrollment)

#### GET /pairings

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.pairing`
- Request: Optional query param `status` (`pending|approved|denied|revoked`)
- Response:
  - `200` JSON `{ status: "ok", pairings: [...] }`
  - `401`, `403`

#### POST /pairings/:id/approve

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.pairing`
- Request: JSON `{ trust_level: "local"|"remote", capability_allowlist: CapabilityDescriptor[], reason?: string }`
- Response:
  - `200` JSON `{ status: "ok", pairing: ... }`
  - `400` invalid request
  - `404` pairing not found / not pending
  - `401`, `403`

#### POST /pairings/:id/deny

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.pairing`
- Request: JSON `{ reason?: string }`
- Response:
  - `200` JSON `{ status: "ok", pairing: ... }`
  - `400`, `404`, `401`, `403`

#### POST /pairings/:id/revoke

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.pairing`
- Request: JSON `{ reason?: string }`
- Response:
  - `200` JSON `{ status: "ok", pairing: ... }`
  - `400`, `404`, `401`, `403`

### Auth profiles & session pins

#### GET /auth/profiles

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: Optional query params: `provider_key`, `status=active|disabled`
- Response:
  - `200` JSON `AuthProfileListResponse`
  - `401`, `403`

#### POST /auth/profiles

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: JSON `AuthProfileCreateRequest`
- Response:
  - `201` JSON `AuthProfileCreateResponse`
  - `400`, `401`, `403`

#### PATCH /auth/profiles/:key

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: JSON `AuthProfileUpdateRequest`
- Response:
  - `200` JSON `{ status: "ok", profile: AuthProfile }`
  - `404` profile not found
  - `400`, `401`, `403`

#### POST /auth/profiles/:key/disable

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: JSON `AuthProfileDisableRequest`
- Response:
  - `200` JSON `{ status: "ok", profile: AuthProfile }`
  - `404` profile not found
  - `400`, `401`, `403`

#### POST /auth/profiles/:key/enable

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: JSON `AuthProfileEnableRequest`
- Response:
  - `200` JSON `{ status: "ok", profile: AuthProfile }`
  - `404` profile not found
  - `400`, `401`, `403`

#### GET /auth/pins

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: Optional query params: `session_id`, `provider_key`
- Response:
  - `200` JSON `SessionProviderPinListResponse`
  - `401`, `403`

#### POST /auth/pins

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: JSON `SessionProviderPinSetRequest`
- Response:
  - `201` JSON `{ status: "ok", pin: SessionProviderPin }` (set)
  - `200` JSON `{ status: "ok", cleared: boolean }` (clear when `profile_id: null`)
  - `400`, `401`, `403`

### Device tokens

#### POST /auth/device-tokens/issue

- Auth: Admin token required
- Availability: Only when gateway auth is enabled (TokenStore is wired)
- Request: JSON `DeviceTokenIssueRequest`
- Response:
  - `201` JSON `DeviceTokenIssueResponse`
  - `403` if admin token is missing/invalid
  - `400` invalid request

#### POST /auth/device-tokens/revoke

- Auth: Admin token required
- Availability: Only when gateway auth is enabled (TokenStore is wired)
- Request: JSON `DeviceTokenRevokeRequest`
- Response:
  - `200` JSON `DeviceTokenRevokeResponse`
  - `403` if admin token is missing/invalid
  - `404` token not found / already revoked

### Provider OAuth (authorization code + PKCE)

#### POST /providers/:provider/oauth/authorize

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Availability: Only when auth profiles are enabled and OAuth providers are configured
- Request: JSON (partial; see `packages/gateway/src/routes/provider-oauth.ts`):
  - `agent_key?: string`
  - `public_base_url?: string` (http/https)
  - `auth_profile_key?: string`
- Response:
  - `200` JSON `{ status: "ok", provider, state, expires_at, authorize_url }`
  - `404` oauth provider not configured
  - `400` invalid request / missing env / etc.
  - `401`, `403`

### Routing config

#### GET /routing/config

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Availability: Only when gateway auth is enabled (TokenStore is wired)
- Request: None
- Response:
  - `200` JSON `{ revision, config, created_at?, created_by?, reason?, reverted_from_revision? }`
  - `500` `{ error: "corrupt_state", ... }`
  - `401`, `403`

#### PUT /routing/config

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Availability: Only when gateway auth is enabled (TokenStore is wired)
- Request: JSON `RoutingConfigUpdateRequest`
- Response:
  - `201` JSON `{ revision, config, created_at, created_by, reason?, reverted_from_revision? }`
  - `400` invalid request
  - `401`, `403`

#### POST /routing/config/revert

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Availability: Only when gateway auth is enabled (TokenStore is wired)
- Request: JSON `RoutingConfigRevertRequest`
- Response:
  - `201` JSON `{ revision, config, created_at, created_by, reason?, reverted_from_revision }`
  - `404` revision not found
  - `400`, `401`, `403`

### Secrets

#### POST /secrets

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Availability: Only when a `SecretProvider` is configured
- Request: Optional query param/header to select agent: `agent_key` or `x-tyrum-agent-key`
- Request: JSON `SecretStoreRequest`
- Response:
  - `201` JSON `{ handle: SecretHandle }` (never returns secret value)
  - `400` invalid request
  - `401`, `403`

#### GET /secrets

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Availability: Only when a `SecretProvider` is configured
- Request: Optional query param/header to select agent: `agent_key` or `x-tyrum-agent-key`
- Response:
  - `200` JSON `{ handles: SecretHandle[] }`
  - `400` invalid agent
  - `401`, `403`

#### DELETE /secrets/:id

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Availability: Only when a `SecretProvider` is configured
- Request: `:id` secret handle id
- Request: Optional query param/header to select agent: `agent_key` or `x-tyrum-agent-key`
- Response:
  - `200` JSON `{ revoked: true }`
  - `404` not found
  - `401`, `403`

#### POST /secrets/:id/rotate

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Availability: Only when a non-env `SecretProvider` is configured
- Request: Optional query param/header to select agent: `agent_key` or `x-tyrum-agent-key`
- Request: JSON `SecretRotateRequest`
- Response:
  - `201` JSON `{ revoked: boolean, handle: SecretHandle }`
  - `404` not found
  - `400` invalid request / env secrets not rotatable
  - `500` rotation propagation failures (best-effort rollback)
  - `401`, `403`

### Snapshot export/import

#### GET /snapshot/export

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: Optional query param `tables` (comma-separated); defaults to gateway snapshot table set
- Response:
  - `200` JSON `SnapshotBundle` (format `tyrum.snapshot.v2`)
  - `400` invalid table name
  - `500` unexpected export failure
  - `401`, `403`

#### POST /snapshot/import

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: JSON `SnapshotImportRequest`
- Response:
  - `200` JSON `{ status: "ok", imported_at, format, tables, inserted_total, inserted_by_table }`
  - `403` `{ error: "disabled", ... }` unless snapshot import is explicitly enabled for the deployment (for example `TYRUM_SNAPSHOT_IMPORT_ENABLED=1` or `--enable-snapshot-import`)
  - `400` invalid request / unknown tables
  - `500` import refused (non-empty tables) or internal failures
  - `401`, `403`

### Memory exports (artifact bytes)

#### GET /memory/exports/:id

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: `:id` is an `ArtifactId` (`@tyrum/schemas`)
- Response:
  - `200` bytes (download) with `Content-Disposition: attachment; filename="tyrum-memory-export-<id>.json"`
  - `404` not found (or not a memory export artifact)
  - `400` invalid artifact id
  - `401`, `403`

### Models.dev catalog

#### GET /models/status

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: None
- Response:
  - `200` JSON `{ status: "ok", models_dev: ... }`
  - `401`, `403`

#### POST /models/refresh

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin` (special-cased)
- Request: None
- Response:
  - `200` JSON `{ status: "ok", models_dev: ... }`
  - `401`, `403`

#### GET /models/providers

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: None
- Response:
  - `200` JSON provider summary list
  - `401`, `403`

#### GET /models/providers/:id

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: Path param `:id`
- Response:
  - `200` JSON provider details
  - `404` provider not found
  - `401`, `403`

#### GET /models/providers/:id/models

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: Path param `:id`
- Response:
  - `200` JSON provider + model list
  - `404` provider not found
  - `401`, `403`

### Plugins

#### GET /plugins

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Availability: Only when plugins are enabled
- Request: None
- Response:
  - `200` JSON `{ status: "ok", plugins: [...] }`
  - `401`, `403`

#### GET /plugins/:id

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Availability: Only when plugins are enabled
- Request: Path param `:id`
- Response:
  - `200` JSON `{ status: "ok", plugin: ... }`
  - `404` plugin not found
  - `401`, `403`

Additional plugin-defined routers may be mounted under:

- `/plugins/<plugin_id>/rpc/*` (methods + paths defined by the plugin)

### Plan runner

#### POST /plan

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.write`
- Request: JSON `PlanRequest` (`@tyrum/schemas`)
- Response:
  - `200` JSON `PlanResponse` (`@tyrum/schemas`)
  - `400` invalid request
  - `401`, `403`

### Workflow engine API (feature-gated)

#### POST /workflow/run

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.write`
- Availability: Only when `TYRUM_ENGINE_API_ENABLED=1`
- Request: JSON `{ key, lane?, plan_id?, request_id?, steps: ActionPrimitive[], budgets? }`
- Response:
  - `200` JSON `{ status: "ok", job_id, run_id, plan_id, request_id, key, lane, steps_count }`
  - `400` invalid request
  - `401`, `403`

#### POST /workflow/resume

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.write`
- Availability: Only when `TYRUM_ENGINE_API_ENABLED=1`
- Request: JSON `{ token: string }`
- Response:
  - `200` JSON `{ status: "ok", run_id }`
  - `404` resume token not found
  - `400`, `401`, `403`

#### POST /workflow/cancel

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.write`
- Availability: Only when `TYRUM_ENGINE_API_ENABLED=1`
- Request: JSON `{ run_id: string, reason?: string }`
- Response:
  - `200` JSON `{ status: "ok", run_id, cancelled: boolean }`
  - `404` run not found
  - `400`, `401`, `403`

### Playbooks

#### GET /playbooks

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: None
- Response:
  - `200` JSON `{ playbooks: [...] }`
  - `401`, `403`

#### GET /playbooks/:id

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: Path param `:id`
- Response:
  - `200` JSON playbook record
  - `404` not found
  - `401`, `403`

#### POST /playbooks/:id/run

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.write`
- Request: None
- Response:
  - `200` JSON playbook run result (non-durable runner)
  - `404` not found
  - `401`, `403`

#### POST /playbooks/runtime

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.write`
- Request: JSON `PlaybookRuntimeRequest`
- Response:
  - `200` JSON runtime envelope (run/resume)
  - `400` unsupported (engine not configured) or invalid request
  - `401`, `403`

#### POST /playbooks/:id/execute

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.write`
- Availability: Only when `TYRUM_ENGINE_API_ENABLED=1`
- Request: JSON (optional overrides): `{ key?, lane?, plan_id?, request_id?, budgets? }`
- Response:
  - `200` JSON `{ status: "ok", job_id, run_id, playbook_id, plan_id, request_id, key, lane, steps_count }`
  - `400` unsupported / invalid request
  - `404` playbook not found
  - `401`, `403`

### Watchers

#### POST /watchers

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.write`
- Request: JSON `{ plan_id: string, trigger_type: string, trigger_config?: unknown }`
- Response:
  - `201` JSON `{ id, plan_id, trigger_type }`
  - `400` invalid request
  - `401`, `403`

#### GET /watchers

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: None
- Response:
  - `200` JSON `{ watchers: [...] }`
  - `401`, `403`

#### PATCH /watchers/:id

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.write`
- Request: JSON `{ active?: boolean }` (only `active:false` is meaningful)
- Response:
  - `200` JSON `{ id, updated: true }`
  - `400` invalid id
  - `401`, `403`

#### DELETE /watchers/:id

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.write`
- Request: None
- Response:
  - `200` JSON `{ id, deleted: true }`
  - `400` invalid id
  - `401`, `403`

#### POST /watchers/:id/trigger/webhook

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.write`
- Request:
  - Headers:
    - `x-tyrum-webhook-signature: sha256=<hex>`
    - `x-tyrum-webhook-timestamp: <unix seconds|ms>`
    - `x-tyrum-webhook-nonce: <base64url|uuid>`
  - Body: raw text (signed as `<timestamp>.<nonce>.<body>`)
- Response:
  - `200` JSON `{ ok: true }` (or trigger-specific result)
  - `401` invalid/missing signature envelope / replay window
  - `404` watcher not found / not webhook
  - `503` misconfigured (missing secret provider / invalid watcher config)
  - `401`, `403`

### Canvas artifacts

#### POST /canvas/publish

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.write`
- Request: JSON `{ plan_id?, title, content_type, html_content, metadata? }`
- Response:
  - `201` JSON `{ id, created_at }`
  - `400` invalid request
  - `401`, `403`

#### GET /canvas/:id

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: Path param `:id`
- Response:
  - `200` HTML/text bytes with restrictive CSP
  - `404` not found
  - `401`, `403`

#### GET /canvas/:id/meta

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: Path param `:id`
- Response:
  - `200` JSON metadata
  - `404` not found
  - `401`, `403`

### Artifacts (execution scope-bound)

#### GET /artifacts/:id/metadata

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: Path param `:id`
- Response:
  - `400` `{ error: "invalid_request", message: "artifact fetch APIs must be scope-bound; use GET /runs/:runId/artifacts/:id/metadata" }`
  - `401`, `403`

#### GET /artifacts/:id

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: Path param `:id`
- Response:
  - `400` `{ error: "invalid_request", message: "artifact fetch APIs must be scope-bound; use GET /runs/:runId/artifacts/:id" }`
  - `401`, `403`

#### GET /runs/:runId/artifacts/:id/metadata

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: Path params `:runId`, `:id` (`ArtifactId`)
- Response:
  - `200` JSON `{ artifact, scope }`
  - `403` forbidden (missing durable scope linkage / policy denies / requires approval)
  - `404` not found
  - `400`, `401`, `403`

#### GET /runs/:runId/artifacts/:id

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Request: Path params `:runId`, `:id` (`ArtifactId`)
- Response:
  - `302` redirect to signed URL (when artifact store supports it)
  - `200` bytes (when artifact bytes are served directly)
  - `403` forbidden (missing durable scope linkage / policy denies / requires approval)
  - `404` not found
  - `400`, `401`, `403`

### Agent runtime (feature-gated)

#### GET /agent/list

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Availability: Only when `TYRUM_AGENT_ENABLED=1`
- Request: Optional query param `include_default` (default: `true`)
- Response:
  - `200` JSON `{ agents: [{ agent_id, home?, has_config? }] }`
  - `401`, `403`

#### GET /agent/status

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Availability: Only when `TYRUM_AGENT_ENABLED=1`
- Request: Optional query param `agent_key` (default: `default`)
- Response:
  - `200` JSON agent runtime status
  - `400` invalid agent key
  - `401`, `403`

#### POST /agent/turn

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.write`
- Availability: Only when `TYRUM_AGENT_ENABLED=1`
- Request: JSON `AgentTurnRequest`
- Response:
  - `200` JSON agent turn result
  - `400` invalid request
  - `502` `{ error: "agent_runtime_error", ... }`
  - `401`, `403`

### Context reports (feature-gated)

#### GET /context

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Availability: Only when `TYRUM_AGENT_ENABLED=1`
- Request: Optional query param `agent_key` (default: `default`)
- Response:
  - `200` JSON `{ status: "ok", report }`
  - `400` invalid agent key
  - `401`, `403`

#### GET /context/list

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Availability: Only when `TYRUM_AGENT_ENABLED=1`
- Request: Optional query params: `session_id`, `run_id`, `limit`
- Response:
  - `200` JSON `{ status: "ok", reports: [...] }`
  - `401`, `403`

#### GET /context/detail/:id

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.read`
- Availability: Only when `TYRUM_AGENT_ENABLED=1`
- Request: Path param `:id`
- Response:
  - `200` JSON `{ status: "ok", report }`
  - `404` not found
  - `401`, `403`

### Ingress (Telegram)

#### POST /ingress/telegram

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.write`
- Request:
  - Raw body text (Telegram update JSON)
  - When Telegram integration is enabled, requires header `x-telegram-bot-api-secret-token`
  - Optional query param `agent_key` to force routing
- Response:
  - `200` JSON normalized update (when agent runtime disabled)
  - `200` JSON `{ ok: true, ... }` when processed/queued
  - `401` invalid telegram webhook secret (when enabled)
  - `503` misconfigured (missing `TELEGRAM_WEBHOOK_SECRET`) or temporary queue failure
  - `400` invalid request / normalization failure
  - `401`, `403`

### Audit

#### GET /audit/export/:planId

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: Path param `:planId`
- Response:
  - `200` JSON receipt bundle
  - `404` no events found
  - `401`, `403`

#### POST /audit/verify

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: JSON `{ events: ChainableEvent[] }`
- Response:
  - `200` JSON verification result
  - `400` invalid request
  - `401`, `403`

#### POST /audit/forget

- Auth: Required (unless gateway auth is disabled)
- Device scope: `operator.admin`
- Request: JSON `AuditForgetRequest`
- Response:
  - `200` JSON `{ decision, deleted_count, proof_event_id }`
  - `400`, `401`, `403`

## WebSocket API

### URL and authentication

- Upgrade endpoint: `GET /ws` (HTTP upgrade)
- WebSocket URL: `ws(s)://<gateway-host>:<port>/ws`

When gateway auth is enabled, the `/ws` upgrade requires a valid token, provided via one of:

- `Authorization: Bearer <token>` header
- Cookie `tyrum_admin_token=<token>` (same-origin upgrades only)
- `Sec-WebSocket-Protocol` token transport:
  - Offer subprotocols including `tyrum-v1` and `tyrum-auth.<base64url(token)>`

### Handshake (connect.init / connect.proof)

After upgrade, the client must complete the v2 handshake:

1. Send `connect.init` (includes role, device identity proof material, and capability descriptors)
2. Receive `connect.init` response (includes a `connection_id` and a server challenge)
3. Send `connect.proof` (signature over a stable transcript including `connection_id` + challenge)
4. Receive `connect.proof` response (includes `client_id`, `device_id`, and `role`)

### Message envelopes

All non-handshake messages are JSON envelopes:

- Requests: `{ request_id: string, type: string, payload: unknown }`
- Responses: `{ request_id: string, type: string, ok: boolean, result?: unknown, error?: { code, message, details? } }`
- Events: `{ event_id: string, type: string, occurred_at: string, payload: unknown, scope?: ... }`

Client-sent events are rejected.

### Message types

#### `connect.init`

- Direction: client → gateway (request), gateway → client (response)
- Schema: `WsConnectInitRequest` (`@tyrum/schemas`)
- Result: `{ connection_id: string, challenge: string }`
- Notes: `protocol_rev` must match the gateway protocol rev; device proof is validated.

#### `connect.proof`

- Direction: client → gateway (request), gateway → client (response)
- Schema: `WsConnectProofRequest` (`@tyrum/schemas`)
- Result: `{ client_id: string, device_id: string, role: WsPeerRole }`

#### `connect`

- Direction: client → gateway (legacy request)
- Notes: Deprecated; the gateway closes with `"legacy connect is deprecated; use connect.init/connect.proof"`.

#### `ping`

- Direction:
  - client → gateway (request)
  - gateway → client (request) and client → gateway (response) (heartbeat)
- Scope (device tokens): allowed (no scopes required)
- Schema: `WsPingRequest`
- Result: none (`ok: true`)

#### `approval.list`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.approvals`
- Schema: `WsApprovalListRequest` (payload parsed as `ApprovalListRequest`)
- Result: `ApprovalListResponse`

#### `approval.resolve`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.approvals`
- Schema: `WsApprovalResolveRequest` (payload parsed as `ApprovalResolveRequest`)
- Result: `ApprovalResolveResponse`

#### `approval.request`

- Direction:
  - gateway → client (request)
  - client → gateway (response)
- Notes: Used for interactive approval flows; client responses are validated with `WsApprovalDecision`.

#### `pairing.approve`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.pairing`
- Schema: `WsPairingApproveRequest`
- Result: `WsPairingResolveResult`

#### `pairing.deny`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.pairing`
- Schema: `WsPairingDenyRequest`
- Result: `WsPairingResolveResult`

#### `pairing.revoke`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.pairing`
- Schema: `WsPairingRevokeRequest`
- Result: `WsPairingResolveResult`

#### `capability.ready`

- Direction: node → gateway (request)
- Scope (device tokens): request is scope-authorized only for connected nodes (device scopes not required)
- Schema: `WsCapabilityReadyRequest`
- Result: none (`ok: true`)

#### `attempt.evidence`

- Direction: node → gateway (request)
- Schema: `WsAttemptEvidenceRequest`
- Result: none (`ok: true`)
- Notes: Evidence is broadcast as an event on success.

#### `task.execute`

- Direction:
  - gateway → node (request)
  - node → gateway (response)
- Notes: Nodes respond with `WsTaskExecuteResult` (success) or an error with evidence details.

#### `session.send`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsSessionSendRequest`
- Result: `WsSessionSendResult`

#### `session.list`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsSessionListRequest`
- Result: `WsSessionListResult`
- Notes: Defaults `agent_id=default`, `channel=ui`, `limit=50`. Cursor is opaque.

#### `session.get`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsSessionGetRequest`
- Result: `WsSessionGetResult`

#### `session.create`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsSessionCreateRequest`
- Result: `WsSessionCreateResult`
- Notes: Defaults `agent_id=default`, `channel=ui`. Server generates `thread_id`.

#### `session.compact`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsSessionCompactRequest`
- Result: `WsSessionCompactResult`
- Notes: Defaults `keep_last_messages=8`.

#### `session.delete`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsSessionDeleteRequest`
- Result: `WsSessionDeleteResult`
- Notes: Best-effort cleanup mirrors `/reset` for the deleted session.

#### `command.execute`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.admin`
- Schema: `WsCommandExecuteRequest`
- Result: `WsCommandExecuteResult`

#### `subagent.spawn`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsSubagentSpawnRequest`
- Result: `WsSubagentSpawnResult`

#### `subagent.list`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsSubagentListRequest`
- Result: `WsSubagentListResult`

#### `subagent.get`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsSubagentGetRequest`
- Result: `WsSubagentGetResult`

#### `subagent.send`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsSubagentSendRequest`
- Result: `WsSubagentSendResult`

#### `subagent.close`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsSubagentCloseRequest`
- Result: `WsSubagentCloseResult`

#### `workflow.run`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsWorkflowRunRequest`
- Result: `WsWorkflowRunResult`

#### `workflow.resume`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsWorkflowResumeRequest`
- Result: `WsWorkflowResumeResult`

#### `workflow.cancel`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsWorkflowCancelRequest`
- Result: `WsWorkflowCancelResult`

#### `memory.search`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsMemorySearchRequest`
- Result: `WsMemorySearchResult`

#### `memory.list`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsMemoryListRequest`
- Result: `WsMemoryListResult`

#### `memory.get`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsMemoryGetRequest`
- Result: `WsMemoryGetResult`

#### `memory.create`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsMemoryCreateRequest`
- Result: `WsMemoryCreateResult`

#### `memory.update`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsMemoryUpdateRequest`
- Result: `WsMemoryUpdateResult`

#### `memory.delete`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsMemoryDeleteRequest`
- Result: `WsMemoryDeleteResult`

#### `memory.forget`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsMemoryForgetRequest`
- Result: `WsMemoryForgetResult`

#### `memory.export`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsMemoryExportRequest`
- Result: `WsMemoryExportResult`

#### `presence.beacon`

- Direction: client|node → gateway (request)
- Scope (device tokens): allowed (no scopes required)
- Schema: `WsPresenceBeaconRequest`
- Result: `WsPresenceBeaconResult`

#### `work.create`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsWorkCreateRequest`
- Result: `WsWorkCreateResult`

#### `work.list`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsWorkListRequest`
- Result: `WsWorkListResult`

#### `work.get`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsWorkGetRequest`
- Result: `WsWorkGetResult`

#### `work.update`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsWorkUpdateRequest`
- Result: `WsWorkUpdateResult`

#### `work.transition`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsWorkTransitionRequest`
- Result: `WsWorkTransitionResult`

#### `work.link.create`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsWorkLinkCreateRequest`
- Result: `WsWorkLinkCreateResult`

#### `work.link.list`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsWorkLinkListRequest`
- Result: `WsWorkLinkListResult`

#### `work.artifact.list`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsWorkArtifactListRequest`
- Result: `WsWorkArtifactListResult`

#### `work.artifact.get`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsWorkArtifactGetRequest`
- Result: `WsWorkArtifactGetResult`

#### `work.artifact.create`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsWorkArtifactCreateRequest`
- Result: `WsWorkArtifactCreateResult`

#### `work.decision.list`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsWorkDecisionListRequest`
- Result: `WsWorkDecisionListResult`

#### `work.decision.get`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsWorkDecisionGetRequest`
- Result: `WsWorkDecisionGetResult`

#### `work.decision.create`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsWorkDecisionCreateRequest`
- Result: `WsWorkDecisionCreateResult`

#### `work.signal.list`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsWorkSignalListRequest`
- Result: `WsWorkSignalListResult`

#### `work.signal.get`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsWorkSignalGetRequest`
- Result: `WsWorkSignalGetResult`

#### `work.signal.create`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsWorkSignalCreateRequest`
- Result: `WsWorkSignalCreateResult`

#### `work.signal.update`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsWorkSignalUpdateRequest`
- Result: `WsWorkSignalUpdateResult`

#### `work.state_kv.get`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsWorkStateKvGetRequest`
- Result: `WsWorkStateKvGetResult`

#### `work.state_kv.list`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.read`
- Schema: `WsWorkStateKvListRequest`
- Result: `WsWorkStateKvListResult`

#### `work.state_kv.set`

- Direction: client → gateway (request)
- Scope (device tokens): `operator.write`
- Schema: `WsWorkStateKvSetRequest`
- Result: `WsWorkStateKvSetResult`
