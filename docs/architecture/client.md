# Client

A client is an operator interface that connects to the gateway and participates in sessions. Clients are where humans read events, send requests, approve actions, and manage connected nodes.

## Client forms

- Desktop app (Windows/Linux/macOS)
- Mobile app (iOS/Android)
- CLI/TUI
- Web app (SPA)

## Responsibilities

- Establish a single WebSocket connection per client device identity (`role: client`).
- Authenticate a user and bind activity to a tenant membership (see [Tenancy](./tenancy.md) and [Gateway authN/authZ](./gateway-authz.md)).
- Send requests (commands, session interactions, configuration changes).
- Subscribe to events (status updates, audit evidence, approvals, pairing requests).
- Provide human approvals and explanations when the gateway escalates.
- Resume or cancel paused workflow runs (via resume tokens) when approvals are resolved.
- Initiate and manage node pairing (approve/deny, label devices, revoke access).
- Provide onboarding and diagnostics surfaces so hardened configuration is easy to reach (see [Operations and onboarding](./operations.md)).
- Support **Admin Mode** (time-bounded step-up) for tenant administration actions.

## Transports and API surfaces

Clients are **WebSocket-first** (interactive control plane) but will often also use HTTP endpoints for resource and bootstrap flows (auth/session, artifacts, callbacks).

See: [API surfaces (WebSocket vs HTTP)](./api-surfaces.md).

## Operator UI expectations

Operator clients provide oversight and administration. At minimum they should expose:

- **Session:** a session-centric view rendered as a unified timeline that merges chat, runs/steps/attempts, approvals, and artifacts (reconstructible from durable state; live events stream updates). The UI supports lane filters and surfaces queue-mode semantics as pending input items.
- **Work:** a workspace-scoped WorkBoard view of active WorkItems (Backlog/Doing/Blocked/Done), with WIP visibility and drilldown into artifacts/decisions/signals linked to runs, approvals, and evidence (see [Work board and delegated execution](./workboard.md)).
- **Approvals:** an approval queue (approve/deny) with previews and linked evidence.
- **Nodes/devices:** pairing requests, connected capability providers, revoke controls.
- **Instances:** a presence view of connected gateway/client/node instances with TTL-based pruning (see [Presence](./presence.md)).
- **Context/usage:** context breakdown (`/context`) and usage/quota panels (`/usage`) for operational transparency (see [Observability](./observability.md)).
- **Settings:** policy defaults, tool allowlists, model config, secrets setup, and automation toggles.
- **Onboarding/check:** guided setup and diagnostics that detect footguns and recommend fixes (see [Operations and onboarding](./operations.md)).

## What a client is not

- A client is not a capability provider. Capabilities live on nodes.
- A client is not required for automation to run, but it is the primary interface for oversight.
