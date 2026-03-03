# API surfaces (WebSocket vs HTTP)

Tyrum is **WebSocket-first**, but not WebSocket-only. The Gateway exposes two operator-facing API surfaces:

- **WebSocket protocol (control plane):** typed requests/responses plus server-push events.
- **HTTP API (resource plane):** bootstrap/auth flows, resource/blob transfer, and callback/webhook endpoints.

The transport you pick is a **delivery detail**. **Scopes + per-method authorization** are the security boundary.

## Principle: scopes are the boundary (not transport)

- The same operator can perform both “day-to-day” actions and “admin” actions.
- Whether an action is _allowed_ is decided by **scopes** (and approvals/policy), not by “it was HTTP” or “it was WS”.
- **Both** HTTP routes and WS request types MUST declare and enforce required scopes (deny-by-default).

Do not define roles in terms of transport (for example “operator = WS” and “admin = HTTP”); define them in terms of scopes.

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

## Elevated Mode crosses both surfaces

Elevated Mode (step-up) is intentionally **transport-agnostic**:

- the client enters Elevated Mode by obtaining a **short-lived elevated device token**
- the SDK uses that token for both **WS requests** and **HTTP calls** during the TTL window
- exiting Elevated Mode returns to the baseline scoped token

Changes to API surfaces are contract changes: update the relevant contracts, enforcement (authZ/audit), and documentation together.
