# Node

A node is a companion runtime that connects to the gateway with `role: node` and exposes capabilities (for example `camera.*`, `canvas.*`, `system.*`). Nodes let Tyrum safely use device-specific interfaces without baking that logic into the gateway.

## Node forms

- Desktop app (Windows/Linux/macOS)
- Mobile app (iOS/Android)
- Headless node (server or embedded device)

## Responsibilities

- Establish a single WebSocket connection per node device identity (`role: node`).
- Advertise supported capabilities and capability versions.
- Execute capability requests and return results/evidence.
- Maintain local device permissions (OS prompts, user consent) as needed.

## Pairing posture

- Nodes connect using a public-key device identity and prove possession of the private key during handshake.
- On first contact, the gateway creates a pairing request for the node device.
- Local nodes can be auto-approved; remote nodes require an explicit operator approval.
- Pairing results in a scoped authorization that can be revoked.

```mermaid
sequenceDiagram
  participant Node
  participant Gateway
  participant Client

  Node->>Gateway: connect.init/connect.proof (role=node, device, capabilities)
  Gateway-->>Client: pairing.requested(node_id, identity)
  Client->>Gateway: pairing.approve(node_id)
  Gateway-->>Node: pairing.approved(scoped_token)
  Node-->>Gateway: capability.ready(...)
```

## Trust and capability scope

Pairing binds a node device identity to an explicit authorization record:

- trust level (for example local vs remote)
- capability allowlist (specific capability names/versions)
- optional labels (operator-defined)

The scoped token issued to the node reflects these constraints. Capability execution requests are authorized against the node’s pairing record and the effective policy snapshot for the run.

## Feature flag

`TYRUM_NODE_PAIRING` (default off). When off, nodes connect using the client-declared capability model. When on, `role: node` connections require pairing approval before receiving tasks. Desktop updates should ship before the flag is enabled.

## Revocation

Revocation removes the pairing authorization and invalidates scoped tokens. A revoked node can reconnect, but it cannot execute capabilities until re-paired.

## Design rationale

Explicit pairing replaces implicit trust-by-connection. Each node gets operator-approved, scoped capabilities stored in a `node_capabilities` table per `device_id`. Immediate revocation prevents compromised devices from continuing to execute. The pairing model builds on the cryptographic device identity from the handshake protocol. Risk: operator fatigue from pairing requests in large deployments; future enhancement: auto-approve rules for known device_id prefixes.
