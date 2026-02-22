# Agent

An agent is a configured runtime persona that owns sessions, a workspace, enabled tools, enabled skills, and memory. The gateway runs agent loops on behalf of an agent identity.

## Agent inputs

- Tool allowlist/policy configuration
- Enabled skills and MCP servers
- Model configuration and fallback chain
- Memory configuration (agent scope, budgets, consolidation, and forget controls)

## Agent outputs

- Replies to sessions (via clients and channels)
- Tool calls and results (with audit evidence)
- Events and logs describing what happened
