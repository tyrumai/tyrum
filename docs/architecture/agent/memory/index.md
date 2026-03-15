---
slug: /architecture/memory
---

# Memory

Memory is Tyrum's durable, agent-scoped knowledge system. It turns transient context and verified outcomes into reusable recall that can survive future turns, channels, and restarts.

## Purpose

The memory subsystem exists so an agent can remain coherent over time without depending on raw transcript replay. It provides durable recall, bounded retrieval, and a safe path from transient experience to reusable knowledge.

## Responsibilities

- Store durable agent-scoped knowledge such as facts, notes, procedures, and episodic provenance.
- Retrieve a bounded, attributed working set of memory for future turns.
- Accept explicit memory writes from users, operators, workflows, and durable work outcomes.
- Keep memory safe and auditable through classification, provenance, and policy-aware retrieval.

## Non-goals

- Memory is not the raw transcript store; sessions and messages are separate durable surfaces.
- Memory is not a secret manager; secrets stay behind a secret-provider boundary.
- Memory is not the active work tracker; current commitments live in the WorkBoard.

## Boundary and ownership

- **Inside the boundary:** durable memory items, episodic provenance, retrieval indexes, and forgetting/consolidation behavior.
- **Outside the boundary:** session transcripts, workspace files, approval records, and active work-state tracking.

## Inputs, outputs, and dependencies

- **Inputs:** explicit "remember this" intent, workflow outcomes, operator annotations, durable work-state outcomes, and pre-turn retrieval cues.
- **Outputs:** prompt-ready recall context, durable memory records, provider-specific memory operations, and audit-visible memory activity.
- **Dependencies:** agent runtime, WorkBoard, provider-specific MCP memory tools, StateStore, and policy/audit boundaries.

## MCP-native interface

Memory is modeled as an **MCP-native capability** rather than a gateway-owned CRUD API. The runtime interacts with the configured provider through stable tool surfaces such as:

- `mcp.memory.seed` for pre-turn hydration and prompt seeding
- `mcp.memory.search` for bounded recall during a turn
- `mcp.memory.write` for durable facts, notes, procedures, and episodic updates

Memory configuration is surfaced through `server_settings.memory`, and retrieval hooks participate in `pre_turn_tools` so the runtime can assemble bounded recall before inference begins.

## State and data

- **Facts and notes:** durable semantic knowledge and operator-visible preferences.
- **Procedures:** reusable strategy records tied to successful or failed outcomes.
- **Episodes and provenance:** the raw material for auditability and later consolidation.
- **Derived indexes:** expendable search/embedding structures that support recall but are never the source of truth.
- **Tombstones:** durable deletion markers that preserve stable ids and deletion proof without retaining the removed content.

## Control flow

1. The runtime gathers retrieval cues from the current turn.
2. The configured memory provider returns bounded, attributed recall context.
3. The agent or workflow writes durable memory when something should survive beyond the current turn.
4. Consolidation and retention policies keep the overall memory set bounded without relying on time-based forgetting.

## Invariants and constraints

- Durable memory is partitioned by `agent_id`.
- Retrieval is bounded and supportive; it must not become an implicit policy override.
- Forgetting is budget-driven, not driven by inactivity alone.

## Failure behavior

- **Expected failures:** failed retrieval, stale derived indexes, over-budget memory sets, and provider-specific tool failures.
- **Recovery path:** best-effort pre-turn hydration, durable canonical records, and budget-triggered consolidation keep the system usable under partial failure.

## Security and policy considerations

- Secrets must not be stored in memory.
- Memory operations remain observable and policy-gated.
- Retrieved memory is supporting context, not authority to perform risky actions.

## Key decisions and tradeoffs

- **Agent-scoped continuity:** one agent's memory survives across channels by default.
- **Provider-backed memory boundary:** memory is now treated as an MCP-native capability rather than a gateway-owned CRUD plane.
- **Budgets over TTL:** retention favors compression and consolidation instead of expiring knowledge simply because it was not used recently.

## Related docs

- [Agent](/architecture/agent)
- [Work board and delegated execution](/architecture/workboard)
- [Context, Compaction, and Pruning](/architecture/context-compaction)
- [Memory consolidation and retention](/architecture/memory/consolidation-retention)
