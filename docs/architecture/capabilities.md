# Capabilities

Status:

A capability is a named interface a node can provide. Capabilities are the bridge between "what the agent wants to do" and "what a device can safely execute".

## Capability shape (conceptual)

- **Namespace:** dot-separated, stable names (for example `camera.capture`, `system.shell.exec`).
- **Operations:** request/response contracts per operation.
- **Evidence:** optional artifacts returned for audit (screenshots, logs, structured receipts).
- **Permissions:** explicit scoping so nodes cannot silently escalate.

## Advertisement and routing

- Nodes advertise the capabilities they support during handshake.
- The gateway routes capability requests to a node that is paired and authorized for that capability.

## Examples

- Microphone
- Camera
- Screenshot
- Screen recording
- Filesystem access (scoped)
- Shell access (scoped, policy-gated)
