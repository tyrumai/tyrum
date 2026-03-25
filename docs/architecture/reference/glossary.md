---
slug: /architecture/glossary
---

# Glossary

This is a scan-first reference lexicon for Tyrum architecture terms. It is intentionally compact. Use the linked architecture pages when you need behavior or mechanics.

## Quick orientation

- **Read this if:** a term in the architecture docs is unfamiliar or overloaded.
- **Skip this if:** you already know the vocabulary and need detailed behavior.
- **Go deeper:** start from [Architecture](/architecture) or the linked subsystem pages instead of treating this page as a tutorial.

## Runtime and identity

| Term       | Short meaning                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| Agent      | Durable runtime persona that keeps conversations, memory, work state, and policy coherent over time. |
| Admin mode | Time-bounded elevated client posture for tenant administration.                                      |
| Client     | Operator peer connected as `role: client`.                                                           |
| Device     | Cryptographic endpoint identity backed by a long-lived signing keypair.                              |
| Membership | A user's role/scopes binding inside one tenant.                                                      |
| Node       | Capability provider connected as `role: node`.                                                       |
| Tenant     | Isolation boundary for identity, policy, and durable state.                                          |
| User       | Human principal authenticated through a tenant-configured auth provider.                             |

## Conversation and context

| Term                   | Short meaning                                                                 |
| ---------------------- | ----------------------------------------------------------------------------- |
| Agent loop             | One turn from inbound input to durable progress.                              |
| Channel                | External messaging integration such as Telegram, Discord, or Google Chat.     |
| Conversation           | Durable context boundary for one agent on one surface.                        |
| Conversation state     | Mutable continuity layer that survives compaction inside one conversation.    |
| Embedded local node    | Node runtime started by a client host but paired as its own node identity.    |
| Heartbeat conversation | Dedicated periodic conversation for one `(agent, workspace)` continuity line. |
| Memory                 | Durable agent-scoped knowledge store used for later recall.                   |
| Memory item            | Addressable long-term memory record.                                          |
| Prompt context         | One turn's bounded model input assembled from durable state.                  |
| Surface                | Broad source of interaction such as UI, channel, automation, or delegation.   |
| Transcript             | Append-only retained event history for one conversation.                      |
| Turn                   | Durable unit of reasoning and progress inside one conversation.               |
| Workspace (filesystem) | Explicit working-directory boundary for workspace-backed tools.               |

## Policy, coordination, and evidence

| Term              | Short meaning                                                                |
| ----------------- | ---------------------------------------------------------------------------- |
| Approval          | Durable operator confirmation gate for risky or side-effecting work.         |
| Artifact          | Durable evidence object linked to a turn, work item, or exportable object.   |
| DecisionRecord    | Durable record of a discrete planning or execution choice.                   |
| Execution profile | Named configuration for model, tool, and budget policy.                      |
| Policy override   | Auditable approval-derived exception that narrows future enforcement.        |
| Turn processing   | Gateway mechanics that queue, pause, resume, and recover turns durably.      |
| ToolIntent        | Record of why a tool call should happen and what evidence it should produce. |

## Work tracking

| Term               | Short meaning                                                                      |
| ------------------ | ---------------------------------------------------------------------------------- |
| Child conversation | Delegated conversation linked to a parent conversation for isolated context.       |
| WorkArtifact       | Typed durable planning or execution artifact attached to a work item or workspace. |
| WorkBoard          | Workspace-scoped work-tracking surface and drilldown state for long-lived work.    |
| Work focus digest  | Budgeted per-turn summary derived from current work state.                         |
| WorkItem           | Operator-facing unit of work with a clear outcome.                                 |
| WorkItem state KV  | Authoritative current-truth values for one work item.                              |
| WorkSignal         | Durable time- or event-based trigger that can enqueue follow-up turns.             |

## Transport, protocol, and extension

| Term                | Short meaning                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Backplane           | Cross-instance delivery path that moves durable outbox items to the owning edge.             |
| Browser node        | Browser-hosted node exposing browser APIs such as camera or geolocation.                     |
| Capability          | Named typed interface a node can provide.                                                    |
| Capability provider | External runtime exposing typed operations, typically a node or MCP server.                  |
| Contract            | Versioned schema for protocol messages or extension interfaces.                              |
| Desktop environment | Gateway-managed sandbox desktop with a paired desktop node.                                  |
| Event               | Gateway-emitted server-push message.                                                         |
| Gateway             | Long-lived service boundary for routing, auth, policy, validation, and durable coordination. |
| Gateway plugin      | Trusted in-process gateway extension module.                                                 |
| Outbox              | Durable event log used for reliable backplane delivery and replay.                           |
| Request/Response    | Correlated typed operation and reply keyed by `request_id`.                                  |
| Skill               | Instruction bundle loaded on demand for specialized workflows.                               |
| Tool                | Invocable operation available to the runtime.                                                |

## Scheduling, storage, and coordination

| Term             | Short meaning                                                                        |
| ---------------- | ------------------------------------------------------------------------------------ |
| Consolidation    | Budget-driven compression of episodic memory into lower-volume durable knowledge.    |
| Lease            | Time-bounded StateStore claim used to coordinate ownership.                          |
| Location trigger | Durable automation rule that fires from enter/exit/dwell location events.            |
| Scheduler        | Component that emits time-based or watcher-driven turns under DB lease coordination. |
| StateStore       | Durable system of record for conversations, approvals, evidence, audit, and routing. |
| Tombstone        | Minimal record proving a memory item was forgotten without keeping its content.      |

## Related docs

- [Architecture](/architecture)
- [Gateway](/architecture/gateway)
- [Agent](/architecture/agent)
- [Messages and Conversations](/architecture/messages-conversations)
- [Conversations and Turns](/architecture/conversations-turns)
- [Protocol](/architecture/protocol)
