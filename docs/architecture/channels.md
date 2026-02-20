# Channels

Channels are message transports that connect Tyrum to external chat surfaces. A channel connector normalizes inbound messages into session events and sends outbound messages when the agent replies.

Channel connectors are a high-risk integration boundary. They are responsible for preserving identity, provenance, and auditability while presenting a consistent messaging model to the gateway.

## Channel types (examples)

- WhatsApp (DM, group)
- Telegram (DM, group)
- Discord (DM, server channel)
- Mattermost (DM, channel)
- IRC (DM, channel)
- Slack (DM, channel)

## Normalized containers

Even when APIs differ, Tyrum should normalize "where a conversation lives" into a small set of containers:

- **DM:** direct message thread
- **Group:** group chat
- **Channel:** named channel (server/workspace)
- **Thread:** optional sub-container (topics/threads) when supported by the provider

Normalized inbound messages follow the envelope rules described in [Messages and Sessions](./messages-sessions.md).

## Inbound reliability (dedupe + debounce)

Connectors make inbound delivery safe and cost-efficient:

- **Dedupe:** prevent redelivery from spawning duplicate runs using a stable `(channel, account_id, container_id, message_id)` key.
- **Debounce:** batch rapid bursts of text into a single turn per container, while attachments flush immediately.

Both behaviors are observable via events and do not weaken execution guarantees.

## Queueing while running

If a run is already active for the target session/lane, connectors apply an explicit queue mode (`collect`, `followup`, `steer`, `steer_backlog`, `interrupt`). Queueing is lane-aware and bounded (cap + overflow policy). Details: [Messages and Sessions](./messages-sessions.md).

## Outbound delivery (side effects)

Outbound sends are treated as side effects:

- Each send carries an idempotency key so retries do not duplicate messages.
- Provider receipts (message ids, timestamps, errors) are captured as audit events and can be stored as artifacts.
- Sending is policy-gated (allowlists, scope rules, and approvals for risky sends).

## Formatting, chunking, and streaming

Connectors render assistant output in a channel-safe way:

- **Markdown → IR → chunk → render** to avoid breaking formatting across chunks.
- Channel-specific caps are enforced (max chars, max lines, media limits).
- Block streaming and typing indicators are supported where providers allow it.

Details: [Markdown Formatting](./markdown-formatting.md).

## Safety expectations

- Connector configuration should be explicit and scoped.
- Message sending should be auditable (evented) and redact secrets by default.
- Connectors must not bypass approvals/policy/sandboxing by “helpfully” performing side effects outside the execution engine.
