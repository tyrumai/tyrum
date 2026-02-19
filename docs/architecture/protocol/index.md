# Protocol

Status:

Tyrum uses a typed WebSocket protocol between the gateway, clients, and nodes. The protocol is designed to be:

- **Typed:** messages are validated against contracts.
- **Bidirectional:** requests/responses plus server-push events.
- **Role-aware:** connections declare a `role` (`client` vs `node`) during handshake.
- **Observable:** important state changes emit events.

The protocol is the primary interface for:

- interactive chat sessions
- workflow execution progress (runs/steps)
- approvals (requested/resolved) and resume control
- node pairing and capability RPC

## Transport

- Primary transport is WebSocket for low-latency, long-lived connectivity.
- Heartbeats detect dead connections and enable safe eviction/reconnect.

## Message classes

- **Handshake:** identifies the connecting device and declares capabilities.
- **Requests/Responses:** client-initiated actions that return a typed response.
- **Events:** gateway-emitted notifications (including server-push progress and lifecycle).

## Next

- [Handshake](./handshake.md)
- [Requests and Responses](./requests-responses.md)
- [Events](./events.md)
