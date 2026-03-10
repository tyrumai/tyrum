# Tools

Tools are the gateway's invocable operations used by the agent runtime. Tools can be built-in, provided by plugins, or exposed via MCP servers.

## Categories

### Built-in tools (examples)

- **runtime:** process and environment information
- **fs:** read/write/edit/apply-patch operations within a workspace boundary
- **session:** session list/history/send/spawn/status operations
- **observability:** status/context/usage inspection and diagnostics
- **memory:** agent-scoped durable memory tools for search + CRUD (create/read/update/delete), with budget enforcement and tombstones for auditability
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
- Treat tool outputs (especially from web pages and channels) as untrusted input and rely on provenance tagging plus policy rules to prevent prompt injection and unsafe tool chaining (see [Sandbox and policy](./sandbox-policy.md)).

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

### Suggested override deny guardrails (hard rule)

Because suggested overrides can become durable policy overrides, they MUST be conservative:

- No **leading wildcards** (for example `*foo`), and avoid broad patterns like `*`.
- Prefer **prefix patterns** over complex matching (for example a single trailing `*`).
- Avoid `?` in suggested overrides (too easy to broaden unintentionally).
- Do not suggest patterns that look like shell-glob arguments (for example `echo *`), since the wildcard language has no escape syntax.

### Match target normalization (hard rule)

Policy overrides and suggested patterns MUST match against a tool-defined **match target** that is:

- **canonical** (equivalent inputs normalize to the same string),
- **unambiguous** (no multiple spellings for the same underlying action), and
- **stable** (format changes are treated like a contract change).

Tools MUST compute match targets from **validated, normalized** inputs (not from raw user/model text). This prevents wildcard patterns from silently broadening over time.

Recommended normalization rules for high-risk tool classes:

- **`fs` (workspace filesystem):**
  - Match target SHOULD include the operation and the _workspace-relative_ canonical path: `op:path`.
  - Path normalization SHOULD use POSIX separators (`/`), strip leading `./`, reject `..`, collapse repeated separators, and apply workspace boundary checks before computing the match target.
  - If symlinks are allowed, the match target SHOULD be based on the resolved canonical path inside the workspace boundary (so the override cannot be bypassed by alternative spellings).
  - Example match targets: `read:src/main.ts`, `write:docs/architecture/backplane.md`, `delete:tmp/output.log`.
- **`bash` / CLI execution:**
  - Match target SHOULD be derived from a structured command representation (argv), not an unparsed shell string.
  - Normalize whitespace and remove non-semantic differences (for example multiple spaces).
  - Do not include secret values in the match target; redact or replace with placeholders.
  - Example match target: `git status --porcelain` (not `git   status   --porcelain`).
- **`messaging` / outbound sends:**
  - Match target SHOULD include the action and a stable destination identifier (connector + account + container/recipient id).
  - Avoid matching on message bodies or display names (too variable; easy to broaden accidentally).
  - Example match target: `send:slack:acct_123:chan_C024BE91L`.
- **`tool.node.dispatch` (node capability dispatch):**
  - Match target SHOULD include the required capability descriptor id and action kind.
  - For Desktop actions, match target SHOULD additionally include a normalized Desktop `op` so policies can distinguish read-only UI operations from state-changing `act`.
  - Match target MUST NOT include user-typed selector text, UI labels, OCR queries, or any other high-entropy values.
  - Example match targets:
    - `capability:tyrum.desktop;action:Desktop;op:snapshot`
    - `capability:tyrum.desktop;action:Desktop;op:query`
    - `capability:tyrum.desktop;action:Desktop;op:wait_for`
    - `capability:tyrum.desktop;action:Desktop;op:act;act:ui`
  - Example safe override patterns:
    - `capability:tyrum.desktop;action:Desktop;op:query`
    - `capability:tyrum.desktop;action:Desktop;op:wait_for`
    - `capability:tyrum.desktop;action:Desktop;op:snapshot`
    - `capability:tyrum.desktop;action:Desktop;op:act*`
- **`tool.automation.schedule.*` (automation schedule management):**
  - Match targets SHOULD encode the stable schedule semantics, not cadence expressions or free-form instructions.
  - `create` SHOULD include normalized schedule kind, execution kind, delivery mode, and any explicit target scope keys.
  - `get` / `pause` / `resume` / `delete` SHOULD anchor to the exact `schedule_id`.
  - `update` SHOULD anchor to the exact `schedule_id` and may include explicitly changed normalized kind/execution/delivery fields.
  - Match targets MUST NOT include cron expressions, interval values, `agent_turn` instruction text, or raw step payloads.
  - Example match targets:
    - `kind:heartbeat;execution:agent_turn;delivery:quiet`
    - `kind:cron;execution:playbook;delivery:notify;playbook_id:playbook-123`
    - `schedule_id:11111111-1111-1111-1111-111111111111`

### Suggested patterns (examples)

Tools define what their override patterns match. Suggested patterns should be conservative and tool-specific:

- **`bash`**: safe prefixes like `git status*`.
- **`fs`**: narrow prefixes like `write:src/generated/*` or `read:docs/architecture/*`.
- **`messaging`**: destination-scoped patterns like `send:slack:acct_123:chan_C024BE91L`.
- **MCP tools**: tool-name prefixes like `mcp.github.*` (prefer stable identifiers over broad argument matches).
- **Automation schedules**: exact heartbeat creation targets like `kind:heartbeat;execution:agent_turn;delivery:quiet`.
