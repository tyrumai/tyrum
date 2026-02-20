# Gateway plugins

A gateway plugin is an **in-process** code module that extends Tyrum with additional features such as commands, tools, and gateway RPC endpoints.

Gateway plugins are **trusted extensions** (they run inside the gateway process). They are not the primary mechanism for per-vendor/per-app integrations; those should generally live in **capability providers** (nodes and MCP servers) so scopes are explicit and blast radius is smaller.

## What plugins can add

- Tools (with typed contracts)
- Slash commands
- Gateway RPC endpoints (scoped)
- MCP server definitions/configuration (the MCP server itself still runs out-of-process)

## Relationship to capability providers

- **Capability providers (preferred for integrations):** out-of-process nodes and MCP servers that expose typed operations and can be paired/scoped/revoked independently.
- **Gateway plugins (preferred for platform extensions):** in-process extensions that add gateway-local features, orchestration glue, or operator UX surfaces.

## Marketplace

Plugins are discoverable and installable from the client UI.

## Safety expectations

- Plugins must declare what they add (tools/commands/endpoints) and what permissions they require.
- Plugin boundaries should be validated by contracts and guarded by policy.
- Prefer least-privilege scopes over broad access.
