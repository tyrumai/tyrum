---
slug: /architecture/execution-backend-conformance
---

# Execution Backend Conformance

Read this if: you are implementing or reviewing an execution backend for Tyrum.

Skip this if: you only need the high-level turn lifecycle; start with [Agent Loop](/architecture/agent-loop).

Go deeper: [Transcript, Conversation State, and Prompt Context](/architecture/transcript-conversation-state) and [Tools](/architecture/tools).

This reference specifies the observable behavior every execution backend must provide, independently of its harness implementation.

## Parent concept

- [Agent Loop](/architecture/agent-loop)

## Scope

These criteria define backend conformance at the Tyrum execution port. They cover transcript durability, streaming, approvals, harness continuity, and tool observations. They do not prescribe harness internals or continuity-file formats.

## Normative conformance criteria

1. **Text turn.** Given a prompt, the backend MUST complete a text turn whose reply is persisted in the Tyrum transcript.
2. **Streaming.** The backend MUST make partial output visible in web chat through `chat.ui-message.stream`, including tool-activity notices.
3. **Approval.** When policy returns `require_approval`, the backend MUST pause the harness tool call until a durable approval is resolved. Operator approval MUST resume the call, and operator denial MUST propagate to the model.
4. **Transcript independence.** The full conversation history MUST remain readable from Tyrum after harness-side continuity files are deleted.
5. **Resume.** A second message MUST continue the same harness execution context. When continuity files are missing, fresh-context recovery MUST seed the harness from Tyrum's conversation-state checkpoint.
6. **Full tool surface and observation tap.** The adapter MUST NOT impose adapter-level tool restrictions. A state-changing call MUST execute only after its durable approval is resolved; a denial MUST propagate to the model as a message; and auto-allowed read-only calls MUST still appear in the transcript through the backend's observation channel.

## Constraints and edge cases

- Passing one criterion does not compensate for failing another; a backend is conformant only when all six criteria pass.
- Harness continuity state is an optimization and continuity aid, not the durable source of transcript truth.
- Backend-specific policy or tool filtering cannot replace Tyrum's durable policy and approval boundary.

## Operational notes

- Run the shared conformance suite against each backend implementation before declaring it available.
- Treat deletion of harness-side continuity files as a required recovery test, not as a destructive operation against Tyrum state.

## Related docs

- [Agent Loop](/architecture/agent-loop)
- [Transcript, Conversation State, and Prompt Context](/architecture/transcript-conversation-state)
- [Tools](/architecture/tools)
