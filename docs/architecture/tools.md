# Tools

Status:

Tools are the gateway's invocable operations used by the agent runtime. Tools can be built-in, provided by plugins, or exposed via MCP servers.

## Categories

### Built-in tools (examples)

- **runtime:** process and environment information
- **fs:** read/write/edit/apply-patch operations within a workspace boundary
- **session:** session list/history/send/spawn/status operations
- **memory:** search/get/write operations over durable memory
- **web:** search/fetch for browsing and extraction (when enabled)
- **ui:** browser/canvas style surfaces (when enabled)
- **automation:** cron/heartbeat/hooks/webhooks
- **messaging:** sending messages to channels
- **nodes:** node discovery, pairing, and capability routing
- **model:** model selection, fallback, and telemetry

### Plugin tools

Plugins can register additional tool descriptors with input/output contracts.

### MCP tools

MCP servers expose tool catalogs that Tyrum can call through a standardized interface.

## Safety and enforcement

- Tool availability is enforced by policy (allowlists/denylists), not by prompt text.
- High-risk tools should require explicit approvals and/or sandbox constraints.
- Tool outputs should redact secrets and avoid leaking sensitive local data by default.
