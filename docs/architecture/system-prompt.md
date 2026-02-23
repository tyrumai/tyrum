# System Prompt

For each agent run, Tyrum assembles a custom system prompt. The purpose is to provide the model with the minimum context and rules needed to act safely and effectively.

## Typical sections

- Tooling: tool list with short descriptions
- Tool schemas: machine-readable contracts for tool invocation (counts toward context)
- Safety: short guardrail reminder to avoid bypassing oversight
- Skills (when available): how to load skill instructions on demand
- Self-update: how to apply config updates and run updates
- Workspace: the working directory boundary for tools and file operations
- Documentation: where local docs live and when to read them
- Injected workspace files: bootstrap context included without explicit reads
- Memory digest: budgeted long-term memory recall (from the StateStore), scoped to the agent
- Sandbox: runtime constraints (including hardening profile) and whether elevated execution is available
- Date and time: user-local time and formatting
- Reply tags: optional provider-specific reply tags
- Heartbeats: periodic prompt and acknowledgement behavior
- Runtime: host/OS/node/model/runtime summary
- Reasoning visibility: visibility level and how it can be toggled (when supported)

## Context report (what the model saw)

For observability, the gateway produces a per-run **context report** that captures:

- injected workspace files (raw vs injected sizes and truncation)
- system prompt section sizes
- skill list overhead
- the largest tool schema contributors

Operator clients expose this via `/context list` and `/context detail` (see [Observability](./observability.md) and [Slash Commands](./slash-commands.md)).

## Advisory vs enforcement

System-prompt guardrails are advisory. Hard enforcement should come from:

- Tool allowlists and parameter validation
- Execution approvals
- Sandboxing and environment constraints
- Channel allowlists and connector policy

## Injected bootstrap files

These files (or equivalents) can be injected as "project context" so the model has identity and safety context without extra tool calls:

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md` (only for brand-new workspaces)

Long-term memory is not represented as a workspace file. It lives in the StateStore and is injected as a **budgeted memory digest** (agent-scoped recall) during context assembly.
