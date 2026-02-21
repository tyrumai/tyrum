# Multi-Agent Routing

Multi-agent routing is the ability to run multiple isolated agents behind one gateway, each with its own workspace and sessions, while routing inbound messages from channels to the correct agent.

## Isolation model

Baseline isolation is enforced via hard namespaces and runtime checks:

- workspaces, sessions, memory, tools, and secrets are scoped per `agent_id`
- cross-agent access is deny-by-default and requires explicit policy

`agent_id TEXT NOT NULL DEFAULT 'default'` is present on all stateful tables: `facts`, `episodic_events`, `capability_memories`, `sessions`, `execution_runs`, `execution_steps`, `execution_attempts`, `approvals`, `artifact_metadata`, `presence_entries`. All DAL queries include `WHERE agent_id = ?` as a mandatory filter. A lint rule flags DAL queries missing the `agent_id` predicate on tables that have the column.

## Feature flag

`TYRUM_MULTI_AGENT` (default off). When off, all operations use `agent_id = 'default'` (single-agent mode). When on, inbound requests include an `agent_id` in the path or message envelope for agent routing. The gateway resolves the target agent, loads its configuration and PolicyBundle, and scopes all subsequent state operations to that `agent_id`.

## Routing rules

Inbound events are mapped to an agent via explicit, auditable bindings.

- Rules start as static configuration mappings.
- The same rule shape can be stored in the StateStore and edited from the control panel.
- Rule changes emit events and are reversible.

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

## Design rationale

Hard namespacing via `agent_id` columns prevents cross-agent data leakage by construction, rather than relying on convention. `DEFAULT 'default'` makes migration seamless for existing single-agent deployments: existing rows are assigned to the default agent without data backfill, and additive column addition is non-blocking on both SQLite and Postgres. Compound indexes include `agent_id` as a leading column to maintain query performance. A missed `agent_id` filter in a DAL query is the most critical risk — mitigated by lint rules, integration tests asserting cross-agent isolation, and code review checklists.
