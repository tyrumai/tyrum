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

### Match target normalization (hard rule)

Policy overrides and suggested patterns MUST match against a tool-defined **match target** that is:

- **canonical** (equivalent inputs normalize to the same string),
- **unambiguous** (no multiple spellings for the same underlying action), and
- **stable** (format changes are treated like a contract change).

Tools MUST compute match targets from **validated, normalized** inputs (not from raw user/model text). This prevents wildcard patterns from silently broadening over time.

Recommended normalization rules for high-risk tool classes:

- **`fs` (workspace filesystem):**
  - Match target SHOULD include the operation and the *workspace-relative* canonical path: `op:path`.
  - Path normalization SHOULD use POSIX separators (`/`), strip leading `./`, reject `..`, collapse repeated separators, and apply workspace boundary checks before computing the match target.
  - If symlinks are allowed, the match target SHOULD be based on the resolved canonical path inside the workspace boundary (so the override cannot be bypassed by alternative spellings).
  - Example match targets: `read:src/app.ts`, `write:docs/architecture/backplane.md`, `delete:tmp/output.log`.
- **`bash` / CLI execution:**
  - Match target SHOULD be derived from a structured command representation (argv), not an unparsed shell string.
  - Normalize whitespace and remove non-semantic differences (for example multiple spaces).
  - Do not include secret values in the match target; redact or replace with placeholders.
  - Example match target: `git status --porcelain` (not `git   status   --porcelain`).
- **`messaging` / outbound sends:**
  - Match target SHOULD include the action and a stable destination identifier (connector + account + container/recipient id).
  - Avoid matching on message bodies or display names (too variable; easy to broaden accidentally).
  - Example match target: `send:slack:acct_123:chan_C024BE91L`.

### Match targets (examples)

Tools define what their override patterns match. Common examples:

- **`bash`**: a normalized command string (for example `git status --porcelain`). Suggested patterns should typically be safe prefixes like `git status*`.
- **`fs`**: an operation + workspace-relative path (for example `write:src/generated/types.ts`). Suggested patterns should be narrow prefixes like `write:src/generated/*`.
- **MCP tools**: a stable tool identifier (server + tool) and optionally selected low-risk arguments. Suggested patterns should prefer tool-name prefixes (for example `mcp.github.*`) over broad argument matches.
