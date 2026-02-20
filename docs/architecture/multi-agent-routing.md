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
