# Glossary

Status:

## Agent

A configured runtime identity that owns sessions, a workspace, enabled tools/skills, and memory.

## Agent loop

The end-to-end path from an inbound message to model inference, tool execution, streaming output, and persistence.

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

The single long-lived daemon that owns connectivity, routing, validation, policy, and persistence.

## Gateway plugin

An in-process code module loaded by the gateway to extend the system (for example tools, slash commands, and gateway RPC endpoints). Gateway plugins are **trusted** extensions and are not the primary mechanism for per-app/per-vendor integrations (prefer capability providers for that).

## Lane

An execution stream within a session (for example `main`, `cron`, `subagent`) used to separate concerns.

## Node

A capability provider connected to the gateway (`role: node`) that executes device-specific operations.

## Request/Response

A typed client-initiated operation and the gateway's typed reply, correlated by `request_id`.

## Session

A durable conversation container with transcript history and queued inbound messages.

## Skill

An instruction bundle loaded on demand to guide the agent in specialized workflows.

## Tool

An invocable operation available to the agent runtime (built-in, gateway-plugin-provided, or MCP-provided).

## Execution engine

The job runner that turns plans/workflows into resilient execution: queueing, retries, idempotency, concurrency limits, budgets/timeouts, pause/resume, and consistent audit/evidence capture.

## Playbook

A durable, reviewable workflow artifact (schema-validated) that describes a multi-step procedure, including explicit approval boundaries, postconditions, and expected evidence artifacts.

## Workflow run

A concrete execution attempt of a playbook (or ad-hoc workflow spec) by the execution engine. A workflow run can complete successfully, fail, or pause awaiting approvals and later resume without re-running prior completed steps.

## Approval

A durable operator confirmation request that gates risky or side-effecting steps. Approvals can pause a workflow run and produce a **resume token** that allows safe continuation after approval/denial.

## Resume token

An opaque, durable token that references the persisted pause state of a workflow run. It allows resuming execution after an approval decision without re-executing already-completed steps.

## Artifact

Audit evidence produced by a run (for example screenshots, diffs, receipts, logs, DOM snapshots). Artifacts are referenced from events and audit logs rather than embedded inline.

## Postcondition

A machine-checkable assertion that proves a step’s intended effect occurred (or that it did not). Postconditions are required for state-changing steps whenever a check is feasible.

## Secret provider

An out-of-process component responsible for storing and retrieving secrets. It returns **secret handles** to the gateway/nodes; raw secret values are not exposed to the model.

## Secret handle

An opaque reference to a secret stored in the secret provider. Executors and capability providers use handles to obtain the secret value at the last responsible moment; the model never receives the raw value.
