---
slug: /architecture/capabilities
---

# Capabilities

A capability is a named interface a node can provide. Capabilities are the bridge between "what the agent wants to do" and "what a device can safely execute".

## Parent concept

- [Node](/architecture/node)

## Capability shape

- **Descriptor id + version:** namespaced capability descriptors (for example `tyrum.browser.geolocation.get@1.0.0`) are the current routing contract.
- **Operations:** request/response contracts per operation.
- **Evidence:** artifacts returned for audit (screenshots, logs, structured receipts). State-changing operations should emit evidence when feasible.
- **Postconditions:** machine-checkable assertions used to verify that a state-changing operation actually succeeded (required when feasible).
- **Permissions:** explicit scoping so nodes cannot silently escalate.

## Advertisement and routing

- Nodes advertise versioned descriptors during handshake.
- The gateway normalizes legacy umbrella descriptors into concrete descriptor ids before routing.
- The gateway routes a capability request only to a node that is paired, allowlisted for that descriptor, and ready to execute it.
- Managed node forms can start from narrower allowlists. Gateway-managed desktop environments, for example, are expected to start with the desktop descriptor set only.

## Common implemented families

- **Browser node:** `tyrum.browser.geolocation.get`, `tyrum.browser.camera.capture-photo`, `tyrum.browser.microphone.record`
- **iOS node:** `tyrum.ios.location.get-current`, `tyrum.ios.camera.capture-photo`, `tyrum.ios.audio.record-clip`
- **Android node:** `tyrum.android.location.get-current`, `tyrum.android.camera.capture-photo`, `tyrum.android.audio.record-clip`
- **Desktop node / managed desktop environment:** `tyrum.desktop.screenshot`, `tyrum.desktop.snapshot`, `tyrum.desktop.query`, `tyrum.desktop.act`, `tyrum.desktop.mouse`, `tyrum.desktop.keyboard`, `tyrum.desktop.wait-for`

These descriptor families map onto typed request/response schemas shared from `@tyrum/schemas`, so node implementations and gateway routing stay aligned on exact operations and evidence shapes.
