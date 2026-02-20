# Memory

Memory is Tyrum's durable store of facts, lessons learned, and episodic events that should outlive a single model context window.

## Kinds of memory

- **Short-term:** recent run context and cached signals (bounded).
- **Long-term:** durable facts and lessons that survive compaction and restarts.
- **Episodic events:** structured records of what happened (useful for audit and troubleshooting).

## Automatic pre-compaction flush

When a session is close to auto-compaction, Tyrum can trigger a silent turn that reminds the agent to write durable memory before older context is summarized away. In many cases the correct behavior is to record memory and produce no user-visible reply.

## Vector memory search

Tyrum can build a small vector index over markdown memory files so semantic queries can locate relevant notes even when wording differs.

## Safety expectations

- Do not store secrets in memory.
- Redact sensitive fields where possible.
- Provide clear user controls for viewing and forgetting memory.
