---
slug: /architecture/messages-sessions
---

# Messages and Sessions

This page defines how Tyrum turns inbound messages into durable sessions and lane-aware execution entrypoints while keeping chat behavior responsive, observable, and safe.

## Purpose

Messages and sessions form the boundary between conversational input and durable agent execution. They normalize inbound content, choose the correct session container, and keep session state stable enough for replay, compaction, and safe follow-up behavior.

## Responsibilities

- Normalize inbound messages from channels and clients into a typed, durable envelope.
- Route input into the correct session container and execution lane.
- Maintain session transcripts and retention semantics as durable conversational state.
- Provide the parent concept for queueing, delivery, and session/lane mechanics.

## Non-goals

- This page does not define the protocol wire contract; see [Protocol](/architecture/protocol).
- This page does not replace execution-engine semantics; it defines how conversational work enters that runtime.

## Boundary and ownership

- **Inside the boundary:** message normalization, session selection, transcript authority, retention semantics, and queue-entry behavior.
- **Outside the boundary:** protocol transport validation, background execution internals, and channel-specific formatting mechanics beyond the normalized messaging model.

## Inputs, outputs, and dependencies

- **Inputs:** inbound messages from clients and channels, connector metadata, attachments, and sender/container identity.
- **Outputs:** normalized session input, durable transcript state, queued follow-up work, and operator-visible message context.
- **Dependencies:** agent runtime, channels, protocol, execution engine, sessions/lanes, WorkBoard, and StateStore-backed retention.

## State and data

- **Normalized envelope:** sender, container, delivery identity, message identity, content, attachments, and provenance tags.
- **Session transcript:** the authoritative conversational context used for future turns.
- **Retention metadata:** compaction windows, transport retention, and repair/debug context.

## Control flow

1. A channel or client message is normalized into Tyrum's message envelope.
2. The gateway resolves the target agent and session container.
3. The message enters the correct `(session_key, lane)` execution stream.
4. Durable transcript state, queued follow-up behavior, and operator-visible delivery state are updated from that single source of truth.

## Invariants and constraints

- Session state is durable and remains the source of truth for future turns.
- Execution is serialized per `(session_key, lane)`.
- Side-effecting delivery remains policy-gated and auditable.

## Failure behavior

- **Expected failures:** duplicate inbound delivery, queue overflow, reconnect churn, and partially retained transport logs.
- **Recovery path:** durable dedupe, repairable transcripts, bounded queueing, and lane-aware serialization keep message handling predictable under retries and restarts.

## Security and policy considerations

- Provenance is preserved so downstream policy can distinguish trusted from untrusted content.
- Direct-message scoping protects against cross-user context leakage in multi-user surfaces.
- Outbound sends remain side effects and stay under approval/policy control.

## Key decisions and tradeoffs

- **Durable sessions over connector state:** Tyrum owns the session key and transcript contract rather than inheriting one provider's chat model.
- **Lane-aware execution:** conversational traffic enters explicit execution lanes instead of assuming one undifferentiated chat stream.
- **Normalized messaging model:** connectors can vary, but the runtime behaves against one typed envelope.

## Related docs

- [Agent](/architecture/agent)
- [Channels](/architecture/channels)
- [Sessions and Lanes](/architecture/sessions-lanes)
- [Message flow control and delivery](/architecture/messages/flow-control-delivery)
- [Markdown Formatting](/architecture/markdown-formatting)
