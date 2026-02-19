# Sessions and Lanes

Status:

A session is a durable conversation container. A lane is an execution stream within a session (for example `main` vs `cron` vs `subagent`).

## Sessions

Target properties:

- One primary direct-chat session per agent.
- Session transcripts are stored and can be replayed for troubleshooting.
- Session identifiers are stable and chosen by Tyrum (not by the model).

## Lanes

Lanes separate concurrent concerns while keeping execution serialized per lane:

- `main` — interactive chat
- `cron` — scheduled work
- `subagent` — delegated work with a narrower scope

## Queue modes (target)

Channels can choose how inbound messages are queued:

- **collect:** coalesce queued messages into a single follow-up turn (default)
- **followup:** enqueue for the next turn after the current run ends
- **steer:** inject into the current run at the next tool boundary (cancels pending tool calls after that boundary)

## Command queue

The gateway should treat the command queue as lane-aware, so automation and interactive work do not trample each other.
