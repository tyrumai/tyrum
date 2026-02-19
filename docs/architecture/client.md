# Client

Status:

A client is an operator interface that connects to the gateway and participates in sessions. Clients are where humans read events, send requests, approve actions, and manage connected nodes.

## Client forms

- Desktop app (Windows/Linux/macOS)
- Mobile app (iOS/Android)
- CLI/TUI
- Web interface served by the gateway

## Responsibilities

- Establish a single WebSocket connection per client device identity (`role: client`).
- Send requests (commands, session interactions, configuration changes).
- Subscribe to events (status updates, audit evidence, approvals, pairing requests).
- Provide human approvals and explanations when the gateway escalates.
- Initiate and manage node pairing (approve/deny, label devices, revoke access).

## What a client is not

- A client is not a capability provider. Capabilities live on nodes.
- A client is not required for automation to run, but it is the primary interface for oversight.
