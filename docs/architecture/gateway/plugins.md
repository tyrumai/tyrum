---
slug: /architecture/plugins
---

# Gateway plugins

A gateway plugin is an **in-process** code module that extends Tyrum with additional features such as commands, tools, and gateway RPC endpoints.

Gateway plugins are **trusted extensions** (they run inside the gateway process). They are not the primary mechanism for per-vendor/per-app integrations; those should generally live in **capability providers** (nodes and MCP servers) so scopes are explicit and blast radius is smaller.

Plugins are part of Tyrum’s extensibility story, but they must not weaken the safety model. The posture is: **easy to extend, hard to accidentally make unsafe**.

## What plugins can add

- Tools (with typed contracts)
- Slash commands
- Gateway RPC endpoints (scoped)
- MCP server definitions/configuration (the MCP server itself still runs out-of-process)

## Plugin manifest (required)

Each plugin must ship a manifest file in its root directory (for example `plugin.yml` / `plugin.yaml` / `plugin.json`) so the gateway can discover and validate plugin metadata **without executing plugin code**.

Minimum required metadata:

- `id`, `name`, `version`
- `entry` (relative ESM entry module path)
- declared contributions (tools/commands/routes/MCP definitions)
- requested permissions (for example DB access, network egress classes, secret scopes)

## Configuration schema (required)

Plugins must declare a **config schema** (JSON Schema) as part of the manifest so:

- plugin configuration can be validated at config load/write time
- unknown keys are rejected (`additionalProperties: false`) unless explicitly allowed
- UIs can render safe forms and label sensitive fields

This is a hard requirement for operability and security: it prevents “config drift” and reduces the need for trial-and-error restarts.

### Manifest and config files

- Manifest field: `config_schema` (a JSON Schema object describing the plugin config)
- Config file: `config.yml` / `config.yaml` / `config.json` in the plugin directory (defaults to `{}` when absent)
- Default safety: for object schemas, `additionalProperties` defaults to `false` unless explicitly set (so unknown keys fail validation)
- Invalid config: the plugin is skipped at load time (and should be surfaced via logs/status surfaces)

## Tool exposure and opt-in

Plugins can register tool descriptors, but tool availability is enforced by policy.

Requirements:

- Tools that cause side effects or expand access (filesystem/network/secrets/messaging) should be **opt-in** by default.
- Optional tools must be explicitly enabled via allowlists (global or per-agent), and must still respect policy/approvals/sandboxing.
- Tool inputs/outputs are contract-validated, redacted, and sized-capped like built-in tools.

Architecture notes:

- Side-effecting plugin tools (declared as requiring confirmation) are **not exposed** to the agent tool directory unless the effective tool policy explicitly opts them in (`allow` or `require_approval`). This makes risky plugin tools opt-in per agent/workspace.

## Relationship to capability providers

- **Capability providers (preferred for integrations):** out-of-process nodes and MCP servers that expose typed operations and can be paired/scoped/revoked independently.
- **Gateway plugins (preferred for platform extensions):** in-process extensions that add gateway-local features, orchestration glue, or operator UX surfaces.

## Marketplace

Plugins are discoverable and installable from operator clients (CLI/UI) with a clear trust model (source, version, integrity).

### Install record (`plugin.lock.json`)

Plugins installed via an operator client should write a lock file in the plugin root: `plugin.lock.json`.

This file records:

- the install source (for example a registry reference or local path)
- the pinned plugin version
- an integrity hash recorded at install time (v1 covers the manifest file contents and the entry module contents)

When `plugin.lock.json` is present, the gateway treats it as an integrity/pinning contract: it refuses to load the plugin if the pinned version or integrity hash does not match what is on disk.

## Discovery and installation hardening

Plugin discovery/install must be hardened because plugins run in-process:

- Block path traversal and symlink escapes for plugin entrypoints.
- Reject plugin roots that are world-writable or have suspicious ownership.
- Prefer registry installs that can record integrity metadata (hashes) and pin versions.
- Avoid executing arbitrary lifecycle scripts during install; prefer “pure JS/TS” dependency trees.

Architecture notes:

- Entry points are validated twice: lexically (no `..` traversal outside the plugin directory) and by resolved real path (no symlink escape outside the plugin directory).
- On POSIX systems, the gateway treats plugin search roots and plugin directories as unsafe when they are world-writable or owned by a different user than the gateway process (root ownership is permitted).

## Auditability

Plugin lifecycle is observable:

- emit events when plugins are loaded/unloaded/failed
- record plugin id/version/source in status surfaces and exported bundles
- record when plugin tools are invoked (tool id + scope + policy snapshot reference)

Event contracts (WebSocket server-push):

- `plugin.lifecycle` — `kind=loaded|failed|unloaded` plus plugin metadata, failure reason/error, and an `audit` link.
- `plugin_tool.invoked` — plugin tool invocation metadata (`tool_call_id`, scope identifiers, `policy_snapshot_id`, outcome, duration) plus an `audit` link.

## Safety expectations

- Plugins run **in-process**. Installing/enabling a plugin is equivalent to running trusted code with the gateway’s privileges.
- Treat plugin install/enable/upgrade as a privileged operation (authenticated operator, auditable events, and approval-gated when appropriate).
- Prefer allowlisted/curated sources; pin versions and verify package integrity/provenance where feasible.
- Plugins must declare what they add (tools/commands/endpoints) and what permissions they require.
- Plugin boundaries should be validated by contracts and guarded by policy.
- Prefer least-privilege scopes over broad access.
