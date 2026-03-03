# Client

A client is an operator interface that connects to the gateway and participates in sessions. Clients are where humans read events, send requests, approve actions, and manage connected nodes.

## Client forms

Clients can take multiple forms, depending on deployment and operator preference:

- Desktop app (Windows/Linux/macOS)
- Operator web UI (SPA served by the gateway at `/ui`)
- CLI (`tyrum-cli`)
- TUI (`tyrum-tui`)
- Mobile app (iOS/Android)

## Responsibilities

- Establish a single WebSocket connection per client device identity (`role: client`).
- Authenticate to the gateway and obtain a scoped device token for the client device identity.
- Send requests (commands, session interactions, configuration changes).
- Subscribe to events (status updates, audit evidence, approvals, pairing requests).
- Provide human approvals and explanations when the gateway escalates.
- Resume or cancel paused workflow runs (via resume tokens) when approvals are resolved.
- Initiate and manage node pairing (approve/deny, label devices, revoke access).
- Provide onboarding and diagnostics surfaces so hardened configuration is easy to reach.
- Support **Elevated Mode** (time-bounded step-up) for administration actions.

## Transports and API surfaces

Clients are **WebSocket-first** (interactive control plane) but will often also use HTTP endpoints for resource and bootstrap flows (auth/session, artifacts, callbacks).

All clients should use the canonical client SDK for WebSocket + HTTP interactions rather than implementing the wire protocol directly.

See: [API surfaces (WebSocket vs HTTP)](./api-surfaces.md).

## Operator surfaces

Operator clients can expose:

- Connection/bootstrap (connect)
- Dashboard/status summary
- Runs view (queued/running/paused + drilldown)
- Approvals queue
- Pairing workflow for nodes/devices
- Settings (including Elevated Mode gating)
- Memory inspection
- Context/usage inspection (for example `/context` and `/usage` equivalents)

Clients that include local device integration can also expose:

- WorkBoard UI (Kanban + drilldown)
- Permissions + diagnostics + logs
- Embedded gateway/node controls (start/stop + local permission prompts)

Clients may also present a unified "Session" timeline view that merges chat, runs/steps/attempts, approvals, and artifacts (reconstructible from durable state; live events stream updates).

## What a client is not

- A client is not a capability provider. Capabilities live on nodes.
- A client is not required for automation to run, but it is the primary interface for oversight.
