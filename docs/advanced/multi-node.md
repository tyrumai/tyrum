# Multi-Node Guide

This guide explains the difference between running multiple independent local nodes and running HA/shared gateway instances.

## Two patterns

### 1. Independent local nodes

Run each node with its own state directory and port.

Use a unique gateway home per node to keep databases and runtime state isolated.

## Example: two local nodes

Node A:

```bash
tyrum --home "$HOME/.tyrum-a" --port 8788
```

Node B:

```bash
tyrum --home "$HOME/.tyrum-b" --port 8789
```

This is still `state.mode=local`. Each node is independent.

### 2. HA / shared instances

Do not share the same gateway home across service instances.

For HA, use:

- `state.mode=shared`
- shared Postgres
- shared artifact storage
- one shared secret key source across all instances
- no mutable runtime fallbacks from the local gateway home

If you are moving from a local node, recreate mutable runtime config in the shared DB-backed surfaces before cutover. There is no filesystem import command.

## Recommended structure

- One process manager entry per node.
- One log stream per node.
- One health check per node.

## Configuration strategy

- Keep shared defaults in deployment config or explicit service definitions.
- Override only per-node values (`--home`, `--port`, host binding) for local-mode nodes.
- For shared mode, keep only instance-local cache/temp paths per node; durable state belongs in shared services.
- Pin release versions during coordinated upgrades.

## Upgrade pattern

1. Upgrade one node first.
2. Validate startup and basic workflows.
3. Roll forward remaining nodes.

## Common mistakes

- Reusing the same gateway home across nodes.
- Treating the local gateway home as shared durable state in HA mode.
- Port collisions between nodes.
- Upgrading all nodes at once without a canary.
