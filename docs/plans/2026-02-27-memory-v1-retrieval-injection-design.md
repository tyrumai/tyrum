# Memory v1 Retrieval Injection (Budgeted Digest) Design

**Goal:** During context assembly, inject a **budgeted, attributed Memory v1 digest** (agent-scoped, from the StateStore) for **interactive and delegated model-inference turns**, so sessions remain coherent under interruptions and compaction.

## Scope (v1)

- Add a **read-path** “Memory digest” injection sourced from `memory_items` (Memory v1).
- Retrieval strategy composition:
  - **Structured lookup**: pinned `fact` keys and/or tagged items (config-driven).
  - **Keyword search**: `MemoryV1Dal.search(query)` (config-driven, deterministic).
  - **Semantic search**: optional, only when enabled and embeddings exist (graceful no-op otherwise).
- Budgets (per agent, configurable):
  - **Per-kind** limits (items + chars; optional approximate tokens).
  - **Overall** limits (items + chars; optional approximate tokens).
- Sensitivity handling:
  - Default: include only `public` + `private` items; exclude `sensitive` from injection.
- Digest output properties:
  - **Bounded** (strict budget enforcement)
  - **Attributed** (stable `memory_item_id` + compact provenance summary)
  - **Safe** (rendered as informational context; does not override policy/approvals)

## Non-goals (v1)

- Replacing/removing the markdown memory **write path** (pre-compaction flush and per-turn append).
- Building a full semantic indexing/rebuild UX or background job (semantic hits are best-effort).
- Implementing “procedure success signals” beyond existing `confidence` (if present).

## Decision: Prompt injection source (Option B)

Replace the current prompt section `Long-term memory matches` (markdown memory + generic vector hits) with `Memory digest` (Memory v1).

Rationale: avoid multiple durable-memory surfaces in the model context while Memory v1 retrieval is being wired in.

## Architecture

### Config (agent.yml)

Extend `memory` config with a `v1` subsection:

- `memory.v1.enabled` (default `true`)
- `memory.v1.allow_sensitivities` (default `["public","private"]`)
- `memory.v1.structured.fact_keys` / `memory.v1.structured.tags` (default empty)
- `memory.v1.keyword.enabled` (default `true`) + limits
- `memory.v1.semantic.enabled` (default `false`)
- `memory.v1.budgets` (per-kind + total)

### Runtime injection

In `AgentRuntime` context assembly:

1. Build `work focus digest` (existing).
2. Build `memory digest` (new):
   - Gather candidates via structured + keyword (+ semantic if enabled).
   - Deduplicate by `memory_item_id`.
   - Select deterministically while enforcing budgets.
   - Format to stable text with IDs + provenance.
3. Include `Memory digest:` as its own prompt part (like Work focus digest).

### Rollback

- Flip `memory.v1.enabled: false` (keeps other prompt parts unchanged).
- Revert the change in `AgentRuntime` context assembly.

## Test plan

- Unit:
  - Budget enforcement (per-kind + total) truncates deterministically.
  - Sensitive items are excluded by default.
- Runtime integration:
  - Model prompt includes `Memory digest:` and selected memory item IDs/snippets for an interactive turn.
  - Delegated (execution-engine) turns also include the digest (same prompt path).
