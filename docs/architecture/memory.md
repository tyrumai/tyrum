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

### Memory item kinds

The architecture supports multiple kinds of memory items, all scoped to `agent_id`:

- **Facts (semantic):** key/value assertions with source and confidence.
- **Notes (semantic/preferences/lessons):** operator- and user-readable memory (often markdown) used for recall.
- **Procedures (procedural):** durable strategy records (“this approach works for capability X”) with success/failure signals.
- **Episodes (episodic):** stored as events plus optional summaries; episodes are the raw material for consolidation.

## Memory tools (agent-facing interface)

Agents interact with durable memory via policy-gated tools that support **search + CRUD**:

- **Search:** retrieve relevant memory items for a query (keyword and/or semantic), returning stable ids and snippets.
- **Create:** store a new memory item (fact/note/procedure) with provenance, confidence, and sensitivity classification.
- **Read:** fetch a memory item by id (and optionally list by filters).
- **Update:** revise an existing memory item (for example increase confidence, refine phrasing, or attach better provenance).
- **Delete:** delete/forget a memory item by id; deletion produces an auditable tombstone and invalidates derived indexes.

All memory tool operations are implicitly scoped to the active `agent_id` so knowledge learned in one channel is available in another.

## Encoding (write path)

Memory can be written from multiple sources:

- **Explicit user intent:** “remember this”, “always/never”, preferences, durable decisions.
- **Workflow outcomes:** successful procedures, failures with lessons learned, approvals and policy outcomes.
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

- Tombstones preserve stable ids and minimal metadata (who/when/why), without retaining the deleted content.
- Tombstones are queryable for “deletion proof” and compliance workflows.
- Tombstones themselves are small and can have their own budget, but should be retained long enough to meet audit policy.

## Safety expectations (hard requirements)

- Do not store secrets in memory.
- Memory must be inspectable and user-controllable (view, export, forget).
- Retrieval must never bypass policy/approvals; memory is supportive context, not an authority to perform risky actions.
- All memory operations are policy-gated and observable (events + audit logs).
