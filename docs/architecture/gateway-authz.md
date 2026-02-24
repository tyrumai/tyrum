# Gateway authN/authZ

This document describes Tyrum’s **gateway authentication (authN)** and **authorization (authZ)** model.

Tyrum is multi-tenant: every authenticated request and connection is bound to exactly one `tenant_id` (see [Tenancy](./tenancy.md)).

The gateway is the authority for identity, scopes, and audit trails. “Safety by prompt” is not a security boundary.

## Goals

- **Secure-by-default access:** expose nothing without explicit configuration, and require auth for all privileged interfaces.
- **Least privilege:** clients and nodes get only the scopes/commands they need.
- **Tenant-scoped access:** credentials are issued within a tenant and cannot cross tenant boundaries.
- **Device-bound access:** credentials are issued to device identities, not “whoever has the URL”.
- **Auditable change control:** auth and authZ decisions produce durable, inspectable evidence.

## Authentication (authN)

### Human authentication (users)

Human users authenticate through a tenant-configured auth provider. Tyrum supports both:

- **Built-in auth** (self-contained user accounts for self-hosted and offline-friendly deployments), and
- **OIDC auth** (SSO/enterprise deployments).

The gateway maps provider identities into a canonical `user_id` and creates/updates tenant membership records that drive authorization.

### Bootstrap and recovery

The gateway exposes an explicit bootstrap/recovery mechanism that can be used to:

- create the first tenant and owner membership in a fresh deployment
- recover access if all admin memberships or devices are lost

Bootstrap credentials are **admin-level** by definition and must be treated as break-glass secrets: used rarely, rotated, and audited.

### Local bootstrap channel (first-device and remote enrollment)

Tyrum provides a local operator channel (for example a CLI/TUI on the gateway host) that can perform tenant administration tasks, including:

- approving/enrolling the first operator device
- approving/enrolling additional non-local operator devices
- approving/revoking nodes

When the gateway is configured for loopback-only access, local operator devices can be auto-approved so a single-user desktop installation is frictionless.

### Device identity + proof

Every WebSocket peer has a **device identity** derived from a long-lived signing keypair. Connections perform a challenge/response so the gateway can bind a connection to the device identity.

See [Handshake](./protocol/handshake.md) and [Identity](./identity.md).

### Session and access tokens

After a user authenticates, the gateway issues short-lived access tokens scoped to:

- `tenant_id`
- `user_id` (or service principal id for nodes)
- peer `role` (`client` or `node`)
- effective scopes / permissions
- optional `device_id` binding

Tokens are presented to the gateway on HTTP requests and WebSocket upgrades (see [Handshake](./protocol/handshake.md)).

## Authorization (authZ)

### Roles, scopes, and surfaces

Peers connect as one of:

- `client` (operator surface)
- `node` (capability provider)

Authorization is based on tenant membership plus explicit scopes. Scopes separate two surfaces:

- **Core product surface:** day-to-day operation (sessions, runs, approvals, artifacts, nodes).
- **Tenant administration surface:** tenant configuration and security operations (users, devices, pairing policy, secrets, exports, enforcement defaults).

Example operator scopes:

- `operator.read` (read-only status/session views)
- `operator.write` (send messages, start runs)
- `operator.approvals` (resolve approvals)
- `operator.pairing` (approve/revoke devices and nodes)
- `operator.admin` (policy changes, plugin management, exports)

**Per-method authorization:** every HTTP route and WS request type declares the scopes required to call it. Deny-by-default is the baseline.

**HTTP scope enforcement:** HTTP requests authenticated with **device tokens** are authorized per-route based on required scopes (for example `operator.read`, `operator.write`). Requests missing the required scope are rejected with `403 forbidden`. The **admin bootstrap token** is break-glass and is treated as wildcard scope for HTTP (intentionally not scope-limited).

**WebSocket scope enforcement:** WebSocket requests authenticated with **device tokens** are authorized per-request based on required scopes. WS requests missing the required scope are rejected with a `forbidden` error response. Deny-by-default applies: if a request type has no scope mapping, scoped tokens are forbidden. The **admin bootstrap token** is break-glass and is treated as wildcard scope for WS.

WebSocket scope matrix (request type → required scope):

| Request type | Required scope |
| --- | --- |
| `approval.list`, `approval.resolve` | `operator.approvals` |
| `pairing.approve`, `pairing.deny`, `pairing.revoke` | `operator.pairing` |
| `session.send`, `workflow.run`, `workflow.resume`, `workflow.cancel` | `operator.write` |
| `command.execute` | `operator.admin` |
| `presence.beacon` | *(none)* |

### Admin mode (step-up)

Operator clients support an **Admin Mode** that grants elevated scopes for a short duration. Entering Admin Mode requires step-up authentication and/or an explicit approval, and it is audited.

Admin Mode limits blast radius: routine usage runs with minimal scopes; tenant administration is explicit and time-bounded.

### Device tokens and enrollment

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

Configuration:

- Set `GATEWAY_TRUSTED_PROXIES` to a comma-separated list of IPs and/or CIDR subnets (example: `127.0.0.1,::1,10.0.0.0/8`).
- When set and the socket remote address matches the allowlist, the gateway derives the client IP from `Forwarded` (preferred), then `X-Forwarded-For`, then `X-Real-IP` (falling back to the socket IP if parsing fails).
- When unset, forwarding headers are ignored and the client IP is always taken from the socket.

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
- include `tenant_id`, `user_id`, and `device_id` (when available) in audit records and events

This is foundational for “many remote coworkers”: the system should answer **who did what, when, and why it was allowed**.
