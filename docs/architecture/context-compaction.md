# Context, Compaction, and Pruning

The context for a run is the message stack provided to the model. Context is bounded by the model's context window (token limit), so long-running sessions use compaction and pruning to stay within limits without losing safety-critical information.

## Context stack

Typical layers:

- System prompt (rules, tools, skills, runtime, injected files)
- Conversation history (user + assistant messages)
- Tool calls/results and attachments (command output, files, images/audio)

Tool schemas (contracts) are also part of what the model receives and therefore count toward the context window even though they are not plain-text history.

## Context reports (inspectability)

For observability, the gateway produces a per-run context report that captures:

- injected workspace files (raw vs injected sizes)
- system prompt section sizes
- largest tool schema contributors
- recent-history and tool-result contributions

Operator clients expose the report via `/context list` and `/context detail` (see [Observability](./observability.md)).

## Compaction

When the session approaches the context limit, older history is compacted into a summary that preserves safety and task-relevant facts.

Compaction should:

- Keep approvals, constraints, and user preferences intact.
- Preserve key decisions and unfinished threads.
- Avoid inventing facts or deleting obligations.

## Pruning (tool-result trimming)

Pruning reduces context bloat by trimming or clearing older tool results in the prompt for a single run while leaving the durable transcript intact.

Pruning:

- applies only to tool-result messages (never to user or assistant turns)
- is deterministic and policy-controlled
- is designed to improve cost and cache behavior for providers that support prompt caching
