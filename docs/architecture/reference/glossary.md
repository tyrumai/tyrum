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

| Term       | Short meaning                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| Agent      | Durable runtime persona that keeps sessions, memory, workspace context, and policy coherent over time. |
| Admin mode | Time-bounded elevated client posture for tenant administration.                                        |
| Client     | Operator peer connected as `role: client`.                                                             |
| Device     | Cryptographic endpoint identity backed by a long-lived signing keypair.                                |
| Membership | A user's role/scopes binding inside one tenant.                                                        |
| Node       | Capability provider connected as `role: node`.                                                         |
| Tenant     | Isolation boundary for identity, policy, and durable state.                                            |
| User       | Human principal authenticated through a tenant-configured auth provider.                               |

## Conversation and context

| Term                   | Short meaning                                                               |
| ---------------------- | --------------------------------------------------------------------------- |
| Agent loop             | Inbound message to model/tool execution, streaming output, and persistence. |
| Agent state KV         | Durable key/value store for pinned agent preferences and constraints.       |
| Channel                | External messaging surface such as WhatsApp, Telegram, or Discord.          |
| Embedded local node    | Node runtime started by a client host but paired as its own node identity.  |
| Lane                   | Execution stream inside a session, such as `main`, `cron`, or `subagent`.   |
| Memory                 | Durable agent-scoped knowledge store used for later recall.                 |
| Memory budget          | Per-agent cap that drives consolidation and eviction.                       |
| Memory item            | Addressable long-term memory record.                                        |
| Session                | Durable conversation container with transcript and queue state.             |
| Workspace (filesystem) | Explicit working-directory boundary for workspace-backed tools.             |

## Execution and policy

| Term              | Short meaning                                                                          |
| ----------------- | -------------------------------------------------------------------------------------- |
| Approval          | Durable operator confirmation gate for risky or side-effecting work.                   |
| DecisionRecord    | Durable record of a discrete planning or execution choice.                             |
| Execution engine  | Queueing, retries, idempotency, pause/resume, and evidence capture for resilient runs. |
| Execution profile | Named execution configuration for model/tool/budget policy.                            |
| IntentGraph       | Derived view of accepted intent and constraints used to detect drift.                  |
| Playbook          | Durable, reviewable workflow spec with approvals and postconditions.                   |
| ToolIntent        | Record of why a tool call should happen and what evidence it should produce.           |
| Workflow run      | One concrete execution attempt of a playbook or ad-hoc workflow.                       |
| Worker            | Process that claims work and performs tool or capability calls.                        |

## Work tracking

| Term              | Short meaning                                                                        |
| ----------------- | ------------------------------------------------------------------------------------ |
| WorkArtifact      | Typed durable execution/planning artifact attached to a work item or workspace.      |
| WorkBoard         | Workspace-scoped work-tracking surface and drilldown state for background execution. |
| Work focus digest | Budgeted per-run summary derived from current work state.                            |
| WorkItem          | Operator-facing unit of work with a clear outcome.                                   |
| WorkItem state KV | Authoritative current plan variables for one work item.                              |
| WorkSignal        | Durable time- or event-based trigger that can enqueue follow-up work.                |

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

## Scheduling, storage, and coordination

| Term             | Short meaning                                                                          |
| ---------------- | -------------------------------------------------------------------------------------- |
| Consolidation    | Budget-driven compression of episodic memory into lower-volume durable knowledge.      |
| Lease            | Time-bounded StateStore claim used to coordinate ownership.                            |
| Location trigger | Durable automation rule that fires from enter/exit/dwell location events.              |
| Scheduler        | Component that emits time-based or watcher-driven work under DB lease coordination.    |
| StateStore       | Durable system of record for sessions, approvals, execution, audit, and routing state. |
| Tombstone        | Minimal record proving a memory item was forgotten without keeping its content.        |

## Tooling and delegation

| Term     | Short meaning                                                                          |
| -------- | -------------------------------------------------------------------------------------- |
| Skill    | Instruction bundle loaded on demand for specialized workflows.                         |
| Subagent | Delegated execution context sharing an agent boundary with a separate session/profile. |
| Tool     | Invocable operation available to the runtime.                                          |

## Related docs

- [Architecture](/architecture)
- [Gateway](/architecture/gateway)
- [Agent](/architecture/agent)
- [Protocol](/architecture/protocol)
- [Scaling and High Availability](/architecture/scaling-ha)
