# Context and Compaction

The context for a run is the message stack provided to the model. Context is bounded by the model's context window (token limit), so long-running sessions need compaction.

## Context stack

Typical layers:

- System prompt (rules, tools, skills, runtime, injected files)
- Conversation history (user + assistant messages)
- Tool calls/results and attachments (command output, files, images/audio)

## Compaction

When the session approaches the context limit, older history is compacted into a summary that preserves safety and task-relevant facts.

Compaction should:

- Keep approvals, constraints, and user preferences intact.
- Preserve key decisions and unfinished threads.
- Avoid inventing facts or deleting obligations.
