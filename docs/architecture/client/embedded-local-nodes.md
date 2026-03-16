---
slug: /architecture/client/embedded-local-nodes
---

# Embedded local nodes

Embedded local nodes are node runtimes started by an operator host, but still connected to the gateway as independent `role: node` peers with their own identity, pairing, and capability state.

## Purpose

This component exists so web, mobile, and desktop operator hosts can expose device-local capabilities without collapsing the client and node trust boundaries into one process or one UI session.

The host owns onboarding, consent UX, and local bootstrap. The embedded runtime still behaves like an ordinary node once it reaches the gateway.

## Responsibilities

- Bootstrap a local node runtime from an operator host.
- Preserve a separate node device identity, presence entry, and pairing lifecycle.
- Surface local consent, readiness, and permission state to the operator.
- Hand off all capability execution to the node path after bootstrap.

## Non-goals

- This component does not let a client execute node RPC directly.
- This component does not replace pairing, review, or policy enforcement with host-local shortcuts.

## Boundary and ownership

- **Inside the boundary:** bootstrap tokens/URLs, host-local consent UX, node startup/shutdown, and local readiness wiring.
- **Outside the boundary:** gateway routing, pairing authorization, capability allowlists, approval policy, and durable orchestration.

## Inputs, outputs, and dependencies

- **Inputs:** operator enablement, host-local runtime APIs, pairing updates, and gateway bootstrap material.
- **Outputs:** a node handshake, capability advertisement/readiness, presence updates, and operator-visible diagnostics.
- **Dependencies:** [Client](/architecture/client), [Node](/architecture/node), [Identity](/architecture/identity), and the typed protocol handshake/event surfaces.

## State and data

- The host keeps its own client device identity and connection state.
- The embedded runtime keeps its own node device identity and pairing record.
- Browser-hosted nodes advertise `mode=browser-node` in presence and connect with browser capability descriptors.
- Mobile onboarding uses a `tyrum://bootstrap?...` payload that carries the gateway HTTP base URL, WebSocket URL, and node bootstrap token.

## Control flow

1. An operator enables local-node support from a host surface such as the browser operator UI or the mobile app.
2. The host loads or creates node identity material, applies local consent/permission checks, and starts the embedded node runtime.
3. The embedded runtime connects as `role: node`, advertises capability descriptors, and enters the normal pairing/review flow.
4. After pairing approval and readiness, the gateway routes capability requests to the embedded node just as it would for any remote node.
5. The client host continues to show status and controls, but capability execution remains on the node side of the boundary.

## Invariants and constraints

- Client and embedded node remain separate peers even when they run inside the same app or browser tab.
- Embedded local nodes must emit ordinary node presence, pairing, and capability-ready signals.
- Local OS or browser permission prompts can block readiness even while the client UI remains connected and healthy.

## Failure behavior

- **Expected failures:** missing browser permissions, mobile deep-link/bootstrap failures, expired bootstrap tokens, and reconnect churn between host and node runtime.
- **Recovery path:** restart the local runtime, reissue bootstrap material when needed, reconnect as `role: node`, and re-advertise readiness without mutating the client identity.

## Security and policy considerations

- Bootstrap material is credential-bearing and should be treated like a scoped node secret.
- Local embedding does not bypass gateway policy, approval, or capability allowlists.
- High-risk capabilities still rely on the ordinary node approval/evidence path even when the node is local to the operator.

## Key decisions and tradeoffs

- **Reuse the node architecture locally:** browser and mobile hosts use the same pairing and capability model as remote nodes, which keeps policy semantics consistent.
- **Separate host UX from capability trust:** the operator host can guide setup and consent without becoming the capability authority.

## Observability

- Embedded nodes appear as separate entries in presence and node inventory.
- Pairing state changes continue to flow through `pairing.updated`.
- Capability readiness and evidence continue to flow through the normal node event stream.

## Related docs

- [Client](/architecture/client)
- [Node](/architecture/node)
- [Capabilities](/architecture/capabilities)
- [Identity](/architecture/identity)
- [Presence and Instances](/architecture/presence)
- [Handshake](/architecture/protocol/handshake)
- [Events](/architecture/protocol/events)
