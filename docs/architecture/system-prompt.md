# System Prompt

Status:

For each agent run, Tyrum assembles a custom system prompt. The purpose is to provide the model with the minimum context and rules needed to act safely and effectively.

## Typical sections

- Tooling: current tool list with short descriptions
- Safety: short guardrail reminder to avoid bypassing oversight
- Skills (when available): how to load skill instructions on demand
- Self-update: how to apply config updates and run updates
- Workspace: the working directory boundary for tools and file operations
- Documentation: where local docs live and when to read them
- Injected workspace files: bootstrap context included without explicit reads
- Sandbox: runtime constraints and whether elevated execution is available
- Current date and time: user-local time and formatting
- Reply tags: optional provider-specific reply tags
- Heartbeats: periodic prompt and acknowledgement behavior
- Runtime: host/OS/node/model/runtime summary
- Reasoning visibility: current visibility level and how it can be toggled (when supported)

## Advisory vs enforcement

System-prompt guardrails are advisory. Hard enforcement should come from:

- Tool allowlists and parameter validation
- Execution approvals
- Sandboxing and environment constraints
- Channel allowlists and connector policy

## Injected bootstrap files (target)

These files (or equivalents) can be injected as "project context" so the model has identity and safety context without extra tool calls:

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md` (only for brand-new workspaces)
- `MEMORY.md`
