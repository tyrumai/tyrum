# Memory

Memory is Tyrum’s durable, **agent-scoped** knowledge system. It converts transient run context into reusable knowledge and retrieves that knowledge safely across future sessions — even when the same agent is communicating over multiple channels.

## Goals

- **Agent-scoped continuity:** a single agent can learn in channel A and use it later in channel B.
- **Durable and auditable:** memory survives restarts and supports “why did it know/do that?” investigation.
- **Bounded by budgets (not time):** inactivity must not cause forgetting; forgetting/compaction happens when budgets are exceeded.
- **Safe by default:** no secrets; privacy-aware retention; explicit user/operator controls.

## Non-goals

- Memory is **not** a raw transcript store (sessions/transcripts are separate durable surfaces).
- Memory is **not** a secret manager (secrets stay behind a secret provider and are referenced by handles).
- Memory is **not** a shared team knowledge base unless explicitly modeled as such (default scope is the agent).
- Memory is **not** a work tracker (active commitments and status live in the WorkBoard; see [Work board and delegated execution](./workboard.md)).

## Scope and identity (hard rule)

All durable memory is partitioned by `agent_id`.

- The agent’s memory is available across all channels and threads that agent participates in.
- Channels/threads contribute **provenance** (where a memory came from) but do not isolate or “silo” memory.
- Deployments that require user-level separation MUST model that separately; agent-scoped memory is the default.

## Automatic pre-compaction flush

When a session is close to auto-compaction, Tyrum will trigger a silent turn that reminds the agent to write durable memory before older context is summarized away. In many cases the correct behavior is to record memory and produce no user-visible reply.

## Brain-inspired model (practical mapping)

Tyrum uses the brain as a **metaphor for useful system behaviors**, not as a neuroscience simulation:

- **Working memory (PFC analogue):** the bounded context stack assembled for a single model call.
- **Episodic memory (hippocampus analogue):** append-only records of what happened (high-fidelity, high-volume).
- **Semantic memory (neocortex analogue):** stable facts and “lessons learned” (lower volume, higher reuse).
- **Procedural memory (basal ganglia/cerebellum analogue):** “what tends to work” (capability/tool strategies).
- **Consolidation (“sleep”):** background compaction that promotes durable lessons and prunes redundancy under budget pressure.

## Memory primitives (what exists)

Memory is stored in the **StateStore** (SQLite/Postgres) as durable records. Conceptually, memory is made of:

- **Memory items:** addressable records (stable ids) containing either structured data (facts) or text (notes).
- **Episodic events:** immutable events that capture experience and provenance for audit/consolidation.
- **Derived indexes:** embeddings/vectors and other indexes used for retrieval. Derived data is never the source of truth.
- **Tombstones:** minimal “deleted” records that preserve auditability without retaining content.

Long-term memory is not loaded from workspace markdown files. `memory/MEMORY.md` and dated markdown memory files are legacy concepts and are not runtime inputs.

### Memory item kinds

The architecture supports multiple kinds of memory items, all scoped to `agent_id`:

- **Facts (semantic):** key/value assertions with source and confidence.
- **Notes (semantic/preferences/lessons):** operator- and user-readable memory (often markdown) used for recall.
- **Procedures (procedural):** durable strategy records (“this approach works for capability X”) with success/failure signals.
- **Episodes (episodic):** stored as events plus optional summaries; episodes are the raw material for consolidation.

## Interfaces (agent vs operator)

Memory v1 is stored in the StateStore and is **agent-scoped** (`agent_id`). The runtime uses it to build a safe, budgeted recall context for model turns, while operators use the Gateway’s operator surfaces to inspect/manage durable state.

### Agent read path (Memory v1 digest)

- Agents do not call the operator memory APIs directly.
- During turn preparation, the runtime builds a **Memory v1 digest** (bounded + attributed + sensitivity-aware) and injects it into the model’s context.

### Operator APIs (WebSocket + HTTP)

- WebSocket requests (typed, operator surface):
  - `memory.list`, `memory.search`, `memory.get` (require `operator.read`)
  - `memory.create`, `memory.update`, `memory.delete`, `memory.forget`, `memory.export` (require `operator.write`)
- HTTP download route (resource plane):
  - `GET /memory/exports/:id` (requires `operator.read`) downloads the JSON export created by `memory.export`.

## Operator workflows (Memory v1)

These workflows are intentionally operator-scoped: they’re designed for audit/debug/compliance, not for in-prompt agent self-modification.

### Inspect (list/search/get)

- **List recent items:** call `memory.list` and page with `next_cursor`.
- **Search:** call `memory.search` with a query (and optional filters).
- **Inspect a specific item:** use the returned `memory_item_id` and call `memory.get` to view the full item + provenance.
- These operations require `operator.read`.

### Export (artifact)

- Run `memory.export` (requires `operator.write`) to produce an export artifact and return an `artifact_id`.
- Download the bytes via `GET /memory/exports/:id` (requires `operator.read`).
- Treat exports as sensitive operational data; store and share them accordingly.

### Forget + tombstones

Forgetting is permanent deletion of canonical content, with audit-friendly proof:

- Use `memory.forget` (requires `operator.write`) with one or more selectors; it requires an explicit `confirm: "FORGET"`.
- Forgetting returns **tombstones** that preserve stable ids + deletion metadata (who/when, plus an optional reason when available) without retaining the deleted content.
- Tombstones can be exported (via `memory.export` with `include_tombstones: true`) to support compliance workflows.

## Encoding (write path)

Memory can be written from multiple sources:

- **Explicit user intent:** “remember this”, “always/never”, preferences, durable decisions.
- **Workflow outcomes:** successful procedures, failures with lessons learned, approvals and policy outcomes.
- **WorkBoard outcomes:** completed WorkItems, DecisionRecords, and verification summaries promoted into semantic/procedural memory (see [Work board and delegated execution](./workboard.md)).
- **Operator annotations:** notes that should persist and apply broadly to the agent.

Write-time safety gates (baseline expectations):

- **Secret detection + redaction:** refuse or redact secret-like content.
- **Classification:** tag sensitivity (public/private/sensitive) to drive access control and retention budgets.
- **Provenance capture:** keep references to where this came from (session id, channel, tool evidence, approvals).

## Retrieval (read path)

Retrieval is cue-based and **budgeted**: the system assembles a small, high-signal set of memories for the current turn.

Typical retrieval strategies (combined and ranked):

- **Structured lookup:** exact keys, tags, and pinned preferences (high precision).
- **Keyword search:** over note text and selected episodic summaries (fast baseline).
- **Semantic search:** embeddings over eligible memory items (high recall).
- **Procedural search:** rank “procedures” by success signals and relevance to the current intent.
- **Association expansion (optional):** a small “spreading activation” step that pulls a few strongly connected items.

Retrieval output MUST be:

- **bounded** (token/char/item budget for injection),
- **attributed** (stable ids + provenance),
- **safe** (treated as information, not as instructions that bypass policy/approvals).

## Consolidation (budget-triggered)

Consolidation converts episodic records into reusable semantic/procedural memory and keeps the whole system bounded.

Key properties:

- Consolidation runs when **budgets are exceeded** (and may also run at task boundaries like “plan completed” or “context compaction happened”).
- Consolidation prefers **compression over deletion**: summarize episodes into notes, merge duplicate facts, and keep “canonical” items.
- Consolidation MAY treat WorkBoard drilldown records as inputs at task boundaries (for example promote DecisionRecords into durable procedures and promote verified outcomes into semantic facts).
- Derived indexes (embeddings) are rebuilt or dropped as needed; they are expendable compared to canonical memory content.

## Budgets and enforcement (no time-based forgetting)

Forgetting is driven by **budgets**, not by wall-clock time:

- Inactivity does not cause forgetting.
- When new memories push the agent over budget, the system performs consolidation/eviction until it returns under budget.

Budgets are per agent and may be expressed as:

- maximum bytes/chars of note text,
- maximum number of items per kind,
- maximum embedding/vector count and/or total vector bytes,
- maximum episodic “detail” retained before summaries replace raw payloads,
- maximum association edge count (if enabled).

### Eviction order (recommended)

When over budget, apply the least-destructive steps first:

1. **Deduplicate and merge** (same facts/notes).
2. **Summarize/compress** high-volume episodic material into semantic notes.
3. **Drop or downsample derived indexes** (embeddings/edges) while keeping canonical content.
4. **Evict low-utility items** (low importance, low access, low confidence), preserving tombstones.

Timestamps may be used as tie-breakers (“least recently activated”) but MUST NOT be used as TTL triggers.

## Forgetting and tombstones

Agents must support explicit, targeted forgetting:

- Forget by stable id (preferred), or by selectors (kind/key/tag/provenance).
- Forgetting deletes canonical content and invalidates derived indexes.

For auditability, forgetting produces **tombstones**:

- Tombstones preserve stable ids and minimal metadata (who/when, and an optional reason when available), without retaining the deleted content.
- Tombstones are queryable for “deletion proof” and compliance workflows.
- Tombstones themselves are small and can have their own budget, but should be retained long enough to meet audit policy.

## Safety expectations (hard requirements)

- Do not store secrets in memory.
- Memory must be inspectable and user-controllable (view, export, forget).
- Retrieval must never bypass policy/approvals; memory is supportive context, not an authority to perform risky actions.
- All memory operations are policy-gated and observable (events + audit logs).
