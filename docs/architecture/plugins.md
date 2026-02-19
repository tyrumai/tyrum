# Plugins

Status:

A plugin is a small code module that extends Tyrum with additional features such as commands, tools, and gateway RPC endpoints.

## What plugins can add

- Tools (with typed contracts)
- Slash commands
- Gateway RPC endpoints (scoped)
- Optional MCP server definitions

## Marketplace (concept)

Tyrum can support a curated marketplace where plugins are discoverable and installable from the client UI.

## Safety expectations

- Plugins must declare what they add (tools/commands/endpoints) and what permissions they require.
- Plugin boundaries should be validated by contracts and guarded by policy.
- Prefer least-privilege scopes over broad access.
