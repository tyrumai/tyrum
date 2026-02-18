# Multi-Node Guide

This guide explains running more than one Tyrum node.

## Core rule

Run each node with its own state directory and port.

Use a unique `TYRUM_HOME` per node to keep databases and runtime state isolated.

## Example: two local nodes

Node A:

```bash
TYRUM_HOME=$HOME/.tyrum-a GATEWAY_PORT=8080 tyrum-gateway
```

Node B:

```bash
TYRUM_HOME=$HOME/.tyrum-b GATEWAY_PORT=8081 tyrum-gateway
```

## Recommended structure

- One process manager entry per node.
- One log stream per node.
- One health check per node.

## Configuration strategy

- Keep shared defaults in environment templates.
- Override only per-node values (`TYRUM_HOME`, `GATEWAY_PORT`, host binding).
- Pin release versions during coordinated upgrades.

## Upgrade pattern

1. Upgrade one node first.
2. Validate startup and basic workflows.
3. Roll forward remaining nodes.

## Common mistakes

- Reusing the same `TYRUM_HOME` across nodes.
- Port collisions between nodes.
- Upgrading all nodes at once without a canary.
