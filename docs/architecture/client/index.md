---
slug: /architecture/client
---

# Client

A client is an operator-facing surface that connects to the gateway and lets humans observe state, steer work, resolve approvals, and manage connected nodes.

## Mission

Clients exist so operators can interact with Tyrum's control plane without coupling the system to one specific UI or device form. They provide the oversight layer for interactive work, background execution, and approval-driven safety, and some hosts also bootstrap adjacent local node runtimes for device-local capabilities.

## Responsibilities

- Establish a client identity and maintain a typed connection to the gateway.
- Present operator-visible state such as runs, approvals, pairing, artifacts, and status.
- Let operators steer execution, resolve approvals, and manage elevated actions.
- Surface onboarding, diagnostics, connected-device workflows, and host-local bootstrap flows for embedded nodes when supported.

## Non-responsibilities

- Clients do not directly own node capability execution or capability authorization; when a surface hosts an embedded local node, that runtime still connects and is governed as `role: node`.
- Clients do not own durable orchestration semantics; they observe and steer the gateway-owned runtime.

## Boundary and ownership

- **Inside the boundary:** connection bootstrap, operator-facing state, approval resolution, pairing UX, host-local setup/consent UX, and device-local presentation concerns.
- **Outside the boundary:** execution control semantics, protocol validation, and node capability execution, even when the node is hosted by the same app or browser tab.

## Internal building blocks

- **Connection and auth bootstrapping:** token or cookie-based entry into the control plane.
- **Operator state surfaces:** runs, approvals, pairing, status, usage, and evidence views.
- **Safety and administration UX:** elevated mode, diagnostics, and configuration workflows.
- **Embedded local node hosts:** browser/mobile/desktop host glue that can bootstrap a separate local node runtime while preserving node identity, pairing, and policy boundaries.

## Interfaces, inputs, outputs, and dependencies

- **Inputs:** server-push events, status snapshots, artifact fetches, and operator actions.
- **Outputs:** typed requests, approval decisions, pairing actions, and administrative changes.
- **Dependencies:** gateway control plane, protocol/contracts, operator-core state, artifact/resource surfaces, and optional host-local bootstrap/runtime APIs.

## Invariants and constraints

- Clients are WebSocket-first for interactive state and event delivery.
- When a client host also runs a local node, the client and node remain separate peers with separate device identities, pairing state, and presence.
- Administrative actions must remain scoped, auditable, and compatible with elevated-mode controls.

## Failure and recovery

- **Failure modes:** disconnects, expired auth, stale local state, and partial reconnect after gateway restarts.
- **Recovery model:** reconnectable protocol sessions plus best-effort re-sync of operator state on connection restore. Embedded local nodes reconnect and re-advertise separately from the client host.

## Security and policy boundaries

- Client actions are governed by scopes and approvals, not by transport.
- Elevated actions remain time-bounded and explicit.
- Client surfaces must not bypass gateway policy enforcement or node authorization, including when a host can bootstrap a local node.

## Key decisions and tradeoffs

- **Shared operator core across UIs:** Tyrum separates renderer-specific UX from shared operator state and actions.
- **Transport-agnostic authorization:** HTTP and WebSocket are not separate trust models; scopes and approvals govern both.
- **Host/runtime split for local capabilities:** operator hosts may embed a node runtime, but capability execution still goes through node identity, pairing, readiness, and policy.
- **Multiple client forms, one control plane:** desktop, web, mobile, CLI, and TUI all map onto the same gateway runtime.

## Drill-down

- [Architecture](/architecture)
- [Embedded Local Nodes](/architecture/client/embedded-local-nodes)
- [Identity](/architecture/identity)
- [Presence and Instances](/architecture/presence)
- [API surfaces (WebSocket vs HTTP)](/architecture/api-surfaces)
