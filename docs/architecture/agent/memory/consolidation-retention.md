---
slug: /architecture/memory/consolidation-retention
---

# Memory consolidation and retention

## Parent concept

- [Memory](/architecture/memory)

## Scope

This page describes how Tyrum keeps durable memory bounded and auditable over time. It covers consolidation, budgets, forgetting, and tombstones rather than the higher-level purpose of memory.

## Automatic pre-compaction flush

When a session is close to auto-compaction, Tyrum can trigger a silent turn that reminds the agent to write durable memory before older context is summarized away. In many cases the correct behavior is to record memory and produce no user-visible reply.

## Consolidation model

Consolidation converts episodic records into reusable semantic or procedural memory and keeps the whole system bounded.

Key properties:

- consolidation runs when budgets are exceeded
- compression is preferred over deletion
- duplicate facts and notes are merged before lower-value content is evicted
- WorkBoard outcomes can be promoted into memory when they become durable lessons or facts

## Budgets and enforcement

Forgetting is driven by budgets, not by wall-clock time.

Budgets may be expressed as:

- maximum bytes or characters of note text
- maximum item count by kind
- maximum embedding or vector footprint
- maximum episodic detail retained before summaries replace raw payloads

Timestamps may be used as tie-breakers, but not as TTL-based deletion triggers.

## Recommended eviction order

When over budget, apply the least-destructive steps first:

1. deduplicate and merge
2. summarize or compress high-volume episodic material
3. drop or downsample derived indexes
4. evict low-utility canonical items while preserving tombstones

## Forgetting and tombstones

Tyrum supports explicit forgetting by stable id or by selectors such as kind, key, tag, or provenance.

For auditability, forgetting produces tombstones:

- tombstones preserve stable ids and minimal metadata
- tombstones support deletion proof and compliance workflows
- tombstones remain bounded, but should survive long enough to meet audit policy

## Safety and operator control

- secrets must never be persisted into memory
- memory administration remains provider-defined and policy-gated
- retrieval must not bypass approvals or policy decisions
- all memory operations should remain observable through events and audit logs

## Related docs

- [Memory](/architecture/memory)
- [Context, Compaction, and Pruning](/architecture/context-compaction)
- [Work board and delegated execution](/architecture/workboard)
