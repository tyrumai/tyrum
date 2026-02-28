# Client

## Status

- **Status:** Partially Implemented

A client is an operator interface that connects to the gateway and participates in sessions. Clients are where humans read events, send requests, approve actions, and manage connected nodes.

## Client forms

### Implemented

- Desktop app (Windows/Linux/macOS)
- Operator web UI (SPA served by the gateway at `/ui`)
- CLI (`tyrum-cli`)
- TUI (`tyrum-tui`)

### Planned

- Mobile app (iOS/Android)

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

All clients should use `@tyrum/client` for WebSocket + HTTP interactions rather than implementing the wire protocol directly.

See: [API surfaces (WebSocket vs HTTP)](./api-surfaces.md).

## Current State

Operator clients currently expose:

- Connection/bootstrap (connect)
- Dashboard/status summary
- Runs view (queued/running/paused + drilldown)
- Approvals queue
- Pairing workflow for nodes/devices
- Settings (including Admin Mode gating)
- Memory inspection

Desktop-only operator surfaces include:

- WorkBoard UI (Kanban + drilldown)
- Permissions + diagnostics + logs
- Embedded gateway/node controls (start/stop + local permission prompts)

There is no dedicated "Session timeline" page yet; runs and work items are the primary drilldown primitives today.

## Target State

Operator clients may add:

- A unified "Session" timeline view that merges chat, runs/steps/attempts, approvals, and artifacts (reconstructible from durable state; live events stream updates).
- Richer WorkBoard surfaces across all clients (not just desktop).
- First-class context/usage panels (beyond `/context` and `/usage` command output).
- Additional clients (for example a mobile app).

## What a client is not

- A client is not a capability provider. Capabilities live on nodes.
- A client is not required for automation to run, but it is the primary interface for oversight.
