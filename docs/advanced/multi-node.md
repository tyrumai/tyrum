# Multi-Node Guide

This guide explains the difference between running multiple independent local nodes and running HA/shared gateway instances.

## Two patterns

### 1. Independent local nodes

Run each node with its own state directory and port.

Use a unique `TYRUM_HOME` per node to keep databases and runtime state isolated.

## Example: two local nodes

Node A:

```bash
TYRUM_HOME=$HOME/.tyrum-a GATEWAY_PORT=8788 tyrum
```

Node B:

```bash
TYRUM_HOME=$HOME/.tyrum-b GATEWAY_PORT=8789 tyrum
```

This is still `state.mode=local`. Each node is independent.

### 2. HA / shared instances

Do not share `TYRUM_HOME` across service instances.

For HA, use:

- `state.mode=shared`
- shared Postgres
- shared artifact storage
- one shared secret key source across all instances
- no mutable runtime fallbacks from `TYRUM_HOME`

If you are moving from a local node, recreate mutable runtime config in the shared DB-backed surfaces before cutover. There is no filesystem import command.

## Recommended structure

- One process manager entry per node.
- One log stream per node.
- One health check per node.

## Configuration strategy

- Keep shared defaults in environment templates.
- Override only per-node values (`TYRUM_HOME`, `GATEWAY_PORT`, host binding) for local-mode nodes.
- For shared mode, keep only instance-local cache/temp paths per node; durable state belongs in shared services.
- Pin release versions during coordinated upgrades.

## Upgrade pattern

1. Upgrade one node first.
2. Validate startup and basic workflows.
3. Roll forward remaining nodes.

## Common mistakes

- Reusing the same `TYRUM_HOME` across nodes.
- Treating `TYRUM_HOME` as shared durable state in HA mode.
- Port collisions between nodes.
- Upgrading all nodes at once without a canary.
