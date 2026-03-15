---
slug: /architecture/sessions-lanes
---

# Sessions and Lanes

A session is a durable conversation container. A lane is an execution stream within a session (for example `main` vs `cron` vs `heartbeat` vs `subagent`).

## Parent concept

- [Messages and Sessions](/architecture/messages-sessions)

## Scope

This page defines the exact keying and lane mechanics behind Tyrum's conversational execution model. It expands the higher-level message/session overview with the durable identifiers and serialization guarantees the runtime depends on.

## Sessions

- Direct messages are scoped to prevent cross-user context leakage.
- Single-user deployments use a shared direct-chat session for continuity.
- Multi-user inbox deployments isolate direct chats per sender by default.
- Session transcripts are stored and can be replayed for troubleshooting.
- Session identifiers are stable and chosen by Tyrum (not by the model).

## Keys

The gateway uses stable keys to:

- route inbound events into the correct session container
- serialize execution per lane
- make audit and replay reliable

## Direct-message scope (secure DM mode)

Tyrum chooses a direct-message scope (`dm_scope`) per agent/channel surface:

- `shared` — all DMs share one session (single-user continuity).
- `per_peer` — isolate by sender identity (secure DM mode).
- `per_channel_peer` — isolate by `(channel, sender)`.
- `per_account_channel_peer` — isolate by `(channel, account, sender)`.

When more than one distinct sender can DM an agent (for example a DM allowlist with multiple entries or an “open DM” policy), Tyrum uses `per_account_channel_peer` by default.

Identity linking can map multiple provider sender ids to a canonical identity so the same person shares a DM session across channels when `dm_scope` is `per_peer`.

### Canonical identity linking

Identity links are stored in the StateStore table `peer_identity_links`, which maps:

- `(channel, account, provider_peer_id)` → `canonical_peer_id`

When `dm_scope` is `per_peer`, the gateway uses `canonical_peer_id` (when present) as `<peerId>` in the session key, enabling per-peer DM continuity across channels.

To link multiple provider identities to the same peer, insert one row per provider identity that shares the same `canonical_peer_id` (an opaque stable id; it must not contain `:`):

```sql
INSERT INTO peer_identity_links (channel, account, provider_peer_id, canonical_peer_id)
VALUES
  ('telegram', 'work', '123', 'peer_550e8400-e29b-41d4-a716-446655440000'),
  ('discord', 'default', '456', 'peer_550e8400-e29b-41d4-a716-446655440000');
```

### Key scheme

- **Agent sessions**
  - Direct (shared): `agent:<agentId>:main`
  - Direct (per peer): `agent:<agentId>:dm:<peerId>`
  - Direct (per channel + peer): `agent:<agentId>:<channel>:dm:<peerId>`
  - Direct (per account + channel + peer): `agent:<agentId>:<channel>:<account>:dm:<peerId>`
  - Group: `agent:<agentId>:<channel>:<account>:group:<id>`
  - Channel: `agent:<agentId>:<channel>:<account>:channel:<id>`
  - Delegated (subagent): `agent:<agentId>:subagent:<subagentId>`
- **Cron**
  - `cron:<jobId>`
- **Hook**
  - `hook:<uuid>`
- **Node**
  - `node:<nodeId>`

### Notes

- `<agentId>` is the gateway’s internal agent identifier.
- `<channel>` is the channel type (for example `telegram`, `whatsapp`, `discord`).
- `<account>` identifies a configured account/connector instance (for example `default`, `family`, `work`) so multiple accounts can coexist safely.
- `<peerId>` is the sender identity for DMs (provider-native or canonical identity when identity linking is enabled).
- `<id>` is the provider-native thread/container identifier (for example a Telegram chat id).
- `<subagentId>` is an opaque stable identifier for delegated execution sessions (it must not contain `:`).

## Lanes

Lanes separate concurrent concerns while keeping execution serialized per lane:

- `main` — interactive chat
- `cron` — scheduled work
- `heartbeat` — context-aware periodic batching inside the main session
- `subagent` — delegated work with a narrower scope

### Relationship to execution runs

Each run is associated with:

- a **key** (one of the keys above)
- a **lane** (`main`, `cron`, `heartbeat`, `subagent`, …)
- a unique `run_id`

Serialization is enforced per `(key, lane)` so concurrent work does not trample shared state, while still allowing independent lanes to progress.

## Distributed serialization (all deployments)

The `(key, lane)` serialization guarantee is enforced using coordination backed by the StateStore (for example advisory locks or lease rows with expiry).

With a single host and a single worker, these locks are typically uncontested, but they are still acquired so the system behaves the same when scaled out: at most one run executes for a given `(key, lane)` at a time.

## Queue modes

When a run is already active for a `(session_key, lane)`, inbound messages are handled by an explicit queue mode:

- **`collect` (default):** coalesce queued messages into a single follow-up turn after the active run ends.
- **`followup`:** enqueue each message as its own follow-up turn.
- **`steer`:** inject the new message into the in-flight run at the next tool boundary and cancel pending tool calls for the current assistant message.
- **`steer_backlog`:** steer now and also preserve the message for a follow-up turn.
- **`interrupt`:** abort the active run at the next safe boundary and run the newest message.

Queueing is bounded (`cap`, `debounce_ms`, `overflow`) and lane-aware so automation lanes do not trample interactive lanes. Details: [Messages and Sessions](/architecture/messages-sessions).

## Command queue

The gateway should treat the command queue as lane-aware, so automation and interactive work do not trample each other.
