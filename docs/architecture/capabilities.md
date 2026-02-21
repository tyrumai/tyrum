# Capabilities

A capability is a named interface a node can provide. Capabilities are the bridge between "what the agent wants to do" and "what a device can safely execute".

## Capability shape

- **Namespace:** dot-separated, stable names (for example `camera.capture`, `system.shell.exec`).
- **Operations:** request/response contracts per operation.
- **Evidence:** artifacts returned for audit (screenshots, logs, structured receipts). State-changing operations should emit evidence when feasible.
- **Postconditions:** machine-checkable assertions used to verify that a state-changing operation actually succeeded (required when feasible).
- **Permissions:** explicit scoping so nodes cannot silently escalate.

## Advertisement and routing

- Nodes advertise the capabilities they support during handshake.
- The gateway routes capability requests to a node that is paired and authorized for that capability.
- Paired node capabilities are stored in a `node_capabilities` table scoped by `device_id`. The gateway enforces these capabilities when routing tasks, replacing client-declared capabilities for paired nodes.

## Examples

- Microphone
- Camera
- Screenshot
- Screen recording
- Filesystem access (scoped)
- Shell access (scoped, policy-gated)
