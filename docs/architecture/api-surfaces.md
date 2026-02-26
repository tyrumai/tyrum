# API surfaces (WebSocket vs HTTP)

Tyrum is **WebSocket-first**, but not WebSocket-only. The Gateway exposes two operator-facing API surfaces:

- **WebSocket protocol (control plane):** typed requests/responses plus server-push events.
- **HTTP API (resource plane):** bootstrap/auth flows, resource/blob transfer, and callback/webhook endpoints.

The transport you pick is a **delivery detail**. **Scopes + per-method authorization** are the security boundary.

## Principle: scopes are the boundary (not transport)

- The same operator can perform both “day-to-day” actions and “admin” actions.
- Whether an action is _allowed_ is decided by **scopes** (and approvals/policy), not by “it was HTTP” or “it was WS”.
- **Both** HTTP routes and WS request types MUST declare and enforce required scopes (deny-by-default).

If you find yourself describing “operator = WS” and “admin = HTTP”, treat that as a _current implementation shape_, not an architectural rule.

## When to use WebSocket

Use WebSocket for **interactive, eventful, low-latency control plane** work:

- streaming timelines (runs/steps/attempts), approvals, pairing, presence
- any UX that benefits from immediate server-push updates
- any operation where you want a single connection to carry: requests + events + heartbeats

In practice: most operator interactions should be WS-first, even if some backing data is fetched over HTTP.

## When to use HTTP

Use HTTP for **resource and integration surfaces**:

- **Browser auth/session bootstrap** (cookies, OIDC callbacks): redirects/callbacks are HTTP-native
- **Artifacts and large payloads** (upload/download): HTTP is better suited than WS for blobs
- **Webhooks/callback ingress** from third-party systems
- **Health/status snapshots** and other “one-shot” reads

HTTP endpoints should still publish events (or otherwise update durable state) so WS-connected clients observe consistent state transitions.

## Avoid dual-surface drift

Do not implement the _same mutation_ twice (once in HTTP, once in WS) unless you have a strong reason.

If you must duplicate a capability across transports:

- share the same core business logic (one implementation, two adapters)
- keep authZ, validation, and audit/event emission consistent
- ensure semantics match (idempotency, error shapes, side effects)

## Admin Mode crosses both surfaces

Admin Mode (step-up) is intentionally **transport-agnostic**:

- the client enters Admin Mode by obtaining a **short-lived elevated device token**
- the SDK uses that token for both **WS requests** and **HTTP calls** during the TTL window
- exiting Admin Mode returns to the baseline scoped token

See: [Gateway authN/authZ](./gateway-authz.md).

## Where to implement changes (map)

This section exists to answer: “where does a new API capability go?”

### Contracts and schemas

- WS wire shapes: `packages/schemas/src/protocol/*` and `packages/schemas/src/protocol.ts`
- HTTP request/response schemas: `packages/schemas/src/*.ts` (for example `packages/schemas/src/device-token.ts`)
- Operator scopes: `packages/schemas/src/scope.ts`

### Gateway (WebSocket surface)

- WS upgrade + auth + connection lifecycle: `packages/gateway/src/routes/ws.ts`
- Request dispatch + per-request authZ: `packages/gateway/src/ws/protocol/handler.ts`, `packages/gateway/src/ws/protocol/dispatch.ts`
- Scope matrix (request type → required scope): `packages/gateway/src/modules/authz/ws-scope-matrix.ts`

### Gateway (HTTP surface)

- HTTP routes: `packages/gateway/src/routes/*.ts`
- Scope enforcement middleware: `packages/gateway/src/modules/authz/http-scope-middleware.ts`
- Cookie/bearer extraction helpers: `packages/gateway/src/modules/auth/http.ts`

### Client SDK (`@tyrum/client`)

- WS client: `packages/client/src/ws-client.ts`
- HTTP client: `packages/client/src/http/client.ts` + `packages/client/src/http/*`
- Public surface: `packages/client/src/index.ts`

### Operator apps / shared operator layers

- Shared state + workflows (should call SDK, not raw fetch/ws): `packages/operator-core/src/operator-core.ts`
- UI components: `packages/operator-ui/src/*`
- App shells: `apps/web/src/*`, `apps/desktop/src/renderer/*`, `packages/cli/src/*`, `packages/tui/src/*`

## Testing expectations

When adding a new capability:

- Add/adjust schemas in `packages/schemas` + tests in `packages/schemas/tests`.
- Add gateway tests for authZ + behavior in `packages/gateway/tests`.
- Add SDK tests/fixtures in `packages/client/tests`.

Docs are part of the contract: if you change a surface, update the relevant `docs/architecture/*` page(s).
