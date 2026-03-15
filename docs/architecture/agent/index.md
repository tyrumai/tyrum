---
slug: /architecture/agent
---

# Agent

An agent is Tyrum's durable runtime persona: the configured identity that owns sessions, workspace state, memory, model selection, and the work-management context needed to stay coherent across turns and channels.

## Mission

The agent runtime turns a configured persona into a stable architectural boundary. It keeps one agent's rules, state, and working set coherent even as requests arrive from different clients, channels, or automation triggers.

## Responsibilities

- Own the agent-scoped runtime configuration: tools, skills, MCP servers, execution profiles, and model selection.
- Maintain durable working context across sessions through workspace state, memory, messages, and work state.
- Translate inbound interactions into agent turns, background work, or policy-gated side effects.
- Provide a stable place to attach operator-visible state such as WorkBoard items, session history, and model/runtime settings.

## Non-responsibilities

- The agent runtime does not own edge connectivity or transport validation; that belongs to the gateway and protocol layers.
- The agent runtime does not execute device-specific automation directly; nodes provide those capabilities.

## Boundary and ownership

- **Inside the boundary:** agent identity, workspace boundary, model/runtime configuration, memory, session context, message handling, and work state.
- **Outside the boundary:** transport ownership, cross-agent routing, durable execution coordination, and device capability execution.

## Internal building blocks

- **Sessions and messages:** durable conversational state and lane-aware execution entrypoints.
- **Workspace and work state:** the workspace filesystem boundary plus the WorkBoard and durable working set.
- **Memory and context assembly:** agent-scoped knowledge, compaction, and prompt-ready recall.
- **Models and runtime policy:** provider/model selection, execution profiles, system prompt shaping, and tool availability.

## Interfaces, inputs, outputs, and dependencies

- **Inputs:** normalized messages, client requests, automation triggers, work-state updates, and memory/tool results.
- **Outputs:** replies, background work requests, durable work-state updates, memory writes, and operator-visible status.
- **Dependencies:** gateway routing, execution engine, protocol/contracts, StateStore, artifacts, models, and node capabilities.

## Invariants and constraints

- Agent-scoped state is partitioned by `agent_id`.
- The agent runtime must survive interruptions by relying on durable state rather than transcript recall alone.
- Interactive execution must stay responsive even when long-running work is delegated into background execution.

## Failure and recovery

- **Failure modes:** model/provider failures, context drift, stale working state, reconnects, and interrupted long-running work.
- **Recovery model:** durable work state, memory compaction, background execution, and resumable runs prevent the runtime from depending on one uninterrupted transcript.

## Security and policy boundaries

- The agent runtime operates within the gateway's policy envelope; it does not bypass approvals, authz, or secret handling rules.
- Secrets remain outside model context and are referenced through approved boundaries only.
- Agent-scoped memory and work state are durable but must remain observable and operator-controllable.

## Key decisions and tradeoffs

- **Agent as the unit of continuity:** memory, workspace, and work state are agent-scoped so continuity survives across channels.
- **Durable work state over prompt-only planning:** active commitments and status live in WorkBoard/state rather than only in transcript history.
- **Shared runtime, separate transport:** the same agent can be reached from multiple operator surfaces without coupling the runtime to one UI.

## Drill-down

- [Architecture](/architecture)
- [Workspace](/architecture/workspace)
- [Models](/architecture/models)
- [Channels](/architecture/channels)
- [Messages and Sessions](/architecture/messages-sessions)
- [Sessions and Lanes](/architecture/sessions-lanes)
- [Memory](/architecture/memory)
- [Work board and delegated execution](/architecture/workboard)
- [Context, Compaction, and Pruning](/architecture/context-compaction)
- [System Prompt](/architecture/system-prompt)
- [Multi-Agent Routing](/architecture/multi-agent-routing)
- [Agent Loop](/architecture/agent-loop)
