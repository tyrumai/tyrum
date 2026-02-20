# Sessions and Lanes

A session is a durable conversation container. A lane is an execution stream within a session (for example `main` vs `cron` vs `subagent`).

## Sessions

- One primary direct-chat session per agent.
- Session transcripts are stored and can be replayed for troubleshooting.
- Session identifiers are stable and chosen by Tyrum (not by the model).

## Keys

The gateway uses stable keys to:

- route inbound events into the correct session container
- serialize execution per lane
- make audit and replay reliable

### Key scheme

- **Agent sessions**
  - `agent:<agentId>:<channel>:main`
  - `agent:<agentId>:<channel>:group:<id>`
  - `agent:<agentId>:<channel>:channel:<id>`
- **Cron**
  - `cron:<jobId>`
- **Hook**
  - `hook:<uuid>`
- **Node**
  - `node:<nodeId>`

### Notes

- `<agentId>` is the gateway’s internal agent identifier.
- `<channel>` should identify a specific connector/account instance (not just a channel type) so multiple accounts can coexist.
- `<id>` is the provider-native thread/container identifier (for example a Telegram chat id).

## Lanes

Lanes separate concurrent concerns while keeping execution serialized per lane:

- `main` — interactive chat
- `cron` — scheduled work
- `subagent` — delegated work with a narrower scope

### Relationship to execution runs

Each run is associated with:

- a **key** (one of the keys above)
- a **lane** (`main`, `cron`, `subagent`, …)
- a unique `run_id`

Serialization is enforced per `(key, lane)` so concurrent work does not trample shared state, while still allowing independent lanes to progress.

## Distributed serialization (all deployments)

The `(key, lane)` serialization guarantee is enforced using coordination backed by the StateStore (for example advisory locks or lease rows with expiry).

With a single host and a single worker, these locks are typically uncontested, but they are still acquired so the system behaves the same when scaled out: at most one run executes for a given `(key, lane)` at a time.

## Queue modes

Channels can choose how inbound messages are queued:

- **collect:** coalesce queued messages into a single follow-up turn (default)
- **followup:** enqueue for the next turn after the active run ends
- **steer:** inject into the in-flight run at the next tool boundary (cancels pending tool calls after that boundary)

## Command queue

The gateway should treat the command queue as lane-aware, so automation and interactive work do not trample each other.
