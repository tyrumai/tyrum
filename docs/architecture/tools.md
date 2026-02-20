# Tools

Tools are the gateway's invocable operations used by the agent runtime. Tools can be built-in, provided by plugins, or exposed via MCP servers.

## Categories

### Built-in tools (examples)

- **runtime:** process and environment information
- **fs:** read/write/edit/apply-patch operations within a workspace boundary
- **session:** session list/history/send/spawn/status operations
- **observability:** status/context/usage inspection and diagnostics
- **memory:** search/get/write operations over durable memory
- **web:** search/fetch for browsing and extraction (when enabled)
- **ui:** browser/canvas style surfaces (when enabled)
- **workflow:** run/resume deterministic workflows (playbooks) with approvals and resume tokens
- **automation:** cron/heartbeat/hooks/webhooks
- **messaging:** sending messages to channels
- **presence:** connected clients/nodes inventory and instance health (when enabled)
- **nodes:** node discovery, pairing, and capability routing
- **model:** model selection, fallback, and telemetry

### Plugin tools

Plugins can register additional tool descriptors with input/output contracts.

### MCP tools

MCP servers expose tool catalogs that Tyrum can call through a standardized interface.

## Safety and enforcement

- Tool availability is enforced by policy (allowlists/denylists), not by prompt text.
- High-risk tools should require explicit approvals and/or sandbox constraints.
- State-changing tools should support **postconditions** and emit **artifacts** suitable for audit.
- Tools should accept **secret handles**, not raw secret values.
- Tool outputs should redact secrets and avoid leaking sensitive local data by default.

## Approval pattern suggestions (approve-always)

When a tool call is policy-gated with `require_approval`, the gateway should provide a bounded set of **suggested overrides** that operator clients can present as “approve always” options.

Guidelines:

- Suggestions are **tool-specific** and conservative (narrow scope, minimal wildcards).
- Suggestions must never propose bypassing an explicit `deny`.
- Suggestions must match a well-defined per-tool **match target** so operators can understand what “always” means.

### Pattern grammar

Suggested override patterns use a simple wildcard language:

- `*` matches zero or more characters
- `?` matches exactly one character

### Match targets (examples)

Tools define what their override patterns match. Common examples:

- **`bash`**: a normalized command string (for example `git status --porcelain`). Suggested patterns should typically be safe prefixes like `git status*`.
- **`fs`**: an operation + workspace-relative path (for example `write:src/generated/types.ts`). Suggested patterns should be narrow like `write:src/generated/**`.
- **MCP tools**: a stable tool identifier (server + tool) and optionally selected low-risk arguments. Suggested patterns should prefer tool-name prefixes (for example `mcp.github.*`) over broad argument matches.
