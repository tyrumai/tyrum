# Multi-Agent Routing

Status:

Multi-agent routing is the ability to run multiple isolated agents behind one gateway, each with its own workspace and sessions, while routing inbound messages from channels to the correct agent.

## Goals

- Multiple agents with strong isolation (workspace + memory + sessions).
- Multiple channel accounts (for example two different WhatsApp accounts) on one gateway.
- Explicit bindings that decide which inbound events map to which agent.

## Safety expectations

- Isolation boundaries must be enforced by the gateway, not by convention.
- Routing decisions should be auditable and reversible.
