# Multi-Agent Routing

Multi-agent routing is the ability to run multiple isolated agents behind one gateway, each with its own workspace and sessions, while routing inbound messages from channels to the correct agent.

## Isolation model

Baseline isolation is enforced via hard namespaces and runtime checks:

- workspaces, sessions, memory, tools, and secrets are scoped per `agent_id`
- cross-agent access is deny-by-default and requires explicit policy

## Routing rules

Inbound events are mapped to an agent via explicit, auditable bindings.

- Rules start as static configuration mappings.
- The same rule shape can be stored in the StateStore and edited from the control panel.
- Rule changes emit events and are reversible.

### Durable routing state (implemented)

Routing rules are persisted as versioned config snapshots in the StateStore:

- Table: `routing_configs` (append-only revisions; newest revision is effective)
- Audit stream: `planner_events.plan_id = "routing.config"` (exportable via `/audit/export/routing.config`)
- WS event: `routing.config.updated` (payload includes `revision`, optional `config_sha256`, and optional `reverted_from_revision`; clients should `GET /routing/config` to fetch the effective config)

Operator API:

- `GET /routing/config` — fetch the effective config + revision
- `PUT /routing/config` — write a new revision
- `POST /routing/config/revert` — create a new revision from an earlier revision

Authentication/authorization:

- Requires a valid gateway token.
- Scoped device tokens must include `operator.admin` for `/routing/*` routes.

Bootstrap behavior:

- If no durable routing config exists, the gateway falls back to the legacy static file config under `TYRUM_HOME` (for example `routing.yml` / `routing.yaml` / `routing.json`).
- Once a durable revision exists and validates against the routing config schema, it becomes the source of truth for routing decisions.

## Key taxonomy

Routing uses the session key conventions described in [Sessions and lanes](./sessions-lanes.md).

- `channel` and `account` identify the connector/account instance (`channel=telegram`, `account=work`).
- Provider-native thread/container identifiers are preserved and stored in the key’s `<id>` portion for groups/channels.
- Direct-message session keys are chosen using `dm_scope` so multi-user inboxes default to per-sender isolation.

This supports multiple accounts on one gateway while keeping session ids stable.

## Stronger isolation mode

Deployments that require OS-level isolation run agents in separate processes/containers with distinct workspaces, policies, and secrets.

## Safety expectations

- Isolation boundaries must be enforced by the gateway, not by convention.
- Routing decisions should be auditable and reversible.
