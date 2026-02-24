# Glossary

## Agent

A configured runtime identity that owns sessions, a workspace, enabled tools/skills, and memory.

## Agent loop

The end-to-end path from an inbound message to model inference, tool execution, streaming output, and persistence.

## Memory

The durable, agent-scoped knowledge system that stores facts, preferences, procedures, and episodic records for later recall. Memory is bounded by **budgets** (not time-based TTL) and supports explicit “forget” with tombstones for auditability.

## Memory item

An addressable long-term memory record (stable id) stored in the StateStore and scoped to an agent. Memory items may be structured (facts) or text (notes) and can have derived indexes (for example embeddings) used for retrieval.

## Memory budget

A per-agent limit on memory volume (for example bytes/items/vectors). When exceeded, the system consolidates and evicts until back under budget. Inactivity must not cause forgetting.

## Consolidation

The process that converts high-volume episodic experience into lower-volume, reusable semantic/procedural memory and prunes redundancy under budget pressure (for example deduplication, summarization, merging facts, dropping derived indexes).

## Tombstone

A minimal durable record indicating a memory item was deleted/forgotten (who/when/why), without retaining the deleted content. Tombstones provide auditability and deletion proof.

## Capability

A named interface a node can provide (for example `camera.capture`) with typed operations and evidence.

## Capability provider

An out-of-process extension runtime that exposes typed operations to the gateway. In Tyrum, the primary capability provider forms are:

- **Node:** a paired device runtime that exposes capabilities over the Tyrum WebSocket protocol.
- **MCP server:** a local/out-of-process server that exposes a catalog of tools over the MCP protocol.

## Channel

An external messaging surface (WhatsApp, Telegram, Discord, etc.) integrated via a connector.

## Client

An operator interface connected to the gateway (`role: client`) that sends requests, receives events, and performs approvals.

## Contract

A versioned schema that defines the shape/semantics of messages and extension interfaces.

## Event

A gateway-emitted server-push message that notifies clients of lifecycle, progress, and state changes.

## Gateway

A long-lived service component that owns edge connectivity, routing, validation, policy enforcement, and durable state coordination. It can be deployed as a single instance or replicated in a cluster.

## Gateway plugin

An in-process code module loaded by the gateway to extend the system (for example tools, slash commands, and gateway RPC endpoints). Gateway plugins are **trusted** extensions and are not the primary mechanism for per-app/per-vendor integrations (prefer capability providers for that).

## StateStore

The system of record for durable state and logs (sessions, approvals, run/job state, audit). SQLite is the default local backend; HA Postgres (or Postgres-compatible managed databases) are used for scale and availability.

## Backplane

A cross-instance event delivery mechanism used in clustered deployments so workers/schedulers can publish events that the gateway edge instances deliver to their connected clients/nodes.

## Tenant

An isolation boundary for identity, policy, and durable state. A deployment hosts one or more tenants; every request, event, and durable record is scoped to exactly one `tenant_id`.

## Worker

A step execution process that claims work (leases) and performs tool/capability calls. Workers scale horizontally.

## User

A human principal authenticated via a tenant-configured auth provider (built-in or OIDC). Users act through client devices.

## Membership

A durable binding of a user into a tenant, including a role and effective scopes. Membership is the unit of authorization and auditing for human actions.

## Device

A cryptographic endpoint identity derived from a long-lived signing keypair. Devices connect to the gateway as WebSocket peers (`role: client` or `role: node`) and are registered, pairable, and revocable.

## Admin mode

A time-bounded elevated access posture within a client UI that grants tenant administration capabilities after step-up authentication and/or explicit approval.

## Scheduler

A component that enqueues work from time-based triggers (cron/watchers/heartbeats). In multi-instance deployments, schedulers coordinate using DB-leases to avoid double-fires.

## Lease

A time-bounded claim stored in the StateStore that coordinates ownership of work or schedules across instances.

## Outbox

A durable event log/table used to publish events reliably to the backplane (supporting replay and recovery).

## Lane

An execution stream within a session (for example `main`, `cron`, `heartbeat`, `subagent`) used to separate concerns.

## Node

A capability provider connected to the gateway (`role: node`) that executes device-specific operations.

## Request/Response

A typed operation and typed reply correlated by `request_id`. Either peer may initiate a request; the other peer sends the response.

## Session

A durable conversation container with transcript history and queue state. Session keys and DM scope rules determine which messages share context.

## Workspace (filesystem)

The agent’s working directory boundary for workspace-backed tools. Workspaces make file operations explicit, containable, and durable across runs. Workspaces are not tenants.

## Skill

An instruction bundle loaded on demand to guide the agent in specialized workflows.

## Tool

An invocable operation available to the agent runtime (built-in, gateway-plugin-provided, or MCP-provided).

## Execution engine

The job runner that turns plans/workflows into resilient execution: queueing, retries, idempotency, concurrency limits, budgets/timeouts, pause/resume, and consistent audit/evidence capture.

## Playbook

A durable, reviewable workflow artifact (schema-validated) that describes a multi-step procedure, including explicit approval boundaries, postconditions, and expected evidence artifacts.

## Workflow run

A concrete execution attempt of a playbook (or ad-hoc workflow spec) by the execution engine. A workflow run can complete successfully, fail, or pause awaiting approvals and resume without re-running prior completed steps.

## Approval

A durable operator confirmation request that gates risky or side-effecting steps. Approvals can pause a workflow run and produce a **resume token** that allows safe continuation after approval/denial.

## Resume token

An opaque, durable token that references the persisted pause state of a workflow run. It allows resuming execution after an approval decision without re-executing already-completed steps.

## Artifact

Audit evidence produced by a run (for example screenshots, diffs, receipts, logs, DOM snapshots). Artifacts are referenced from events and audit logs rather than embedded inline.

## Postcondition

A machine-checkable assertion that proves a step’s expected effect occurred (or that it did not). Postconditions are required for state-changing steps whenever a check is feasible.

## Secret provider

An out-of-process component responsible for storing and retrieving secrets. It returns **secret handles** to the gateway/nodes; raw secret values are not exposed to the model.

## Secret handle

An opaque reference to a secret stored in the secret provider. Executors and capability providers use handles to obtain the secret value at the last responsible moment; the model never receives the raw value.

## Auth profile

A durable record describing how Tyrum authenticates to a provider (API key or OAuth), represented as metadata plus secret handles. Auth profiles are scoped per agent and participate in deterministic rotation and model failover.

## Context report

A gateway-generated breakdown of what was included in a model call (system prompt sections, injected files, tool schema overhead, and history/tool-result contributions). Context reports are persisted with runs for audit and debugging.

## Debounce

A per-container batching mechanism that coalesces rapid bursts of inbound text messages into a single agent turn within a time window.

## Dedupe

A reliability mechanism that detects and drops duplicate inbound deliveries (for example channel redelivery after reconnect) so they do not start duplicate runs.

## DM scope

A policy that determines how direct messages map to session keys (`shared`, `per_peer`, `per_channel_peer`, `per_account_channel_peer`) to prevent cross-sender context leakage in multi-user inboxes.

## Queue mode

The policy used when a run is already active for a session/lane, controlling whether inbound messages are collected, enqueued for follow-up, steered into the in-flight run, or interrupt the run.

## Markdown IR

An intermediate representation of Markdown used for channel-safe chunking and rendering: plain text plus structured spans for styles, links, and blocks.

## Presence

A best-effort, TTL-bounded view of the gateway, connected clients, and connected nodes, used for operator visibility (“Instances”).

## Typing indicator

A channel-side UX signal sent while a run is active to indicate the system is working. Typing behavior is connector-specific and policy-controlled.

## Usage tracking

Operator-visible accounting of tokens/time/cost per run and provider-reported usage/quota windows when available, exposed via `/usage` and UI panels.
