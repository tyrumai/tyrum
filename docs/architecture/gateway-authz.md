# Gateway authN/authZ

This document describes Tyrum’s **gateway authentication (authN)** and **authorization (authZ)** model. It supports both:

- **Personal assistant mode** (single operator, local-first).
- **Remote coworker / team mode** (multiple operators, remote access, explicit access control).

The gateway is the authority for identity, scopes, and audit trails. “Safety by prompt” is not a security boundary.

## Goals

- **Secure-by-default access:** expose nothing without explicit configuration, and require auth for all privileged interfaces.
- **Least privilege:** clients and nodes get only the scopes/commands they need.
- **Device-bound access:** credentials are issued to device identities, not “whoever has the URL”.
- **Auditable change control:** auth and authZ decisions produce durable, inspectable evidence.

## Authentication (authN)

### Bootstrap token

The gateway requires an operator bootstrap token (for example `GATEWAY_TOKEN`) for initial access over both:

- HTTP APIs (Authorization header), and
- WebSocket upgrade (subprotocol token transport).

Bootstrap tokens are treated as **admin-level** credentials and should be used only to enroll devices or recover access.

### Device identity + proof

Every WebSocket peer has a **device identity** derived from a long-lived signing keypair. Connections perform a challenge/response so the gateway can bind a connection to the device identity.

See [Handshake](./protocol/handshake.md) and [Identity](./identity.md).

## Authorization (authZ)

### Roles and scopes

Peers connect as one of:

- `client` (operator surface)
- `node` (capability provider)

Operator clients present an explicit list of scopes (examples):

- `operator.read` (read-only status/session views)
- `operator.write` (send messages, start runs)
- `operator.approvals` (resolve approvals)
- `operator.pairing` (approve/revoke devices and nodes)
- `operator.admin` (policy changes, plugin management, exports)

**Per-method authorization:** every HTTP route and WS request type declares the scopes required to call it. Deny-by-default is the baseline.

### Device tokens

When a device proves identity, the gateway can issue a **device token** that is:

- bound to `{ device_id, role }`
- scoped (subset of operator scopes, or node capability scopes)
- revocable and rotatable

Device tokens replace bootstrap-token usage for normal operation.

Rotation and revocation are operator actions and are audited. Revocation immediately invalidates the device token and blocks reconnect until re-approved.

### Node authorization (capabilities and commands)

Nodes are capability providers and are always treated as high-risk.

Posture:

- Nodes advertise **capabilities** (high-level categories) and optionally **commands/permissions** (fine-grained claims).
- The gateway enforces server-side allow/deny rules in two places:
  - pairing record (what this node is allowed to do in general), and
  - per-run policy snapshot (what this specific run is allowed to invoke).

Pairing is required before a node can execute privileged capabilities. Pairing binds a node device identity to an allowlist and is revocable at any time.

## Trusted proxies (remote access)

When the gateway runs behind a reverse proxy (nginx/Caddy/Traefik), Tyrum must avoid “local-trust” bypasses where proxied requests appear to come from `127.0.0.1`.

Requirements:

- Only trust `X-Forwarded-For` / `Forwarded` / `X-Real-IP` headers from an explicit `trusted_proxies` allowlist.
- When `trusted_proxies` is unset, treat forwarding headers as untrusted data and derive client IP from the socket.
- When the gateway is exposed beyond loopback, require auth and require device-bound tokens; do not rely on IP-based trust.

## TLS and pinning

Remote operation requires TLS (direct or terminated at a proxy).

Requirements:

- Clients can be configured with a **TLS certificate fingerprint** (pinning) for high-assurance remote access.
- Pinning is optional but recommended for “remote coworker / team mode” deployments where users connect over untrusted networks.

## Audit and observability

AuthN/authZ decisions must be observable and durable:

- log and event failed auth attempts (rate-limited)
- audit device enroll/approve/revoke/rotate actions
- record the scope set used for each privileged action (method/route + scope check result)

This is foundational for “many remote coworkers”: the system should answer **who did what, when, and why it was allowed**.
