# ADR-003: Node Pairing Model

**Status**: Accepted
**Date**: 2026-02-20

## Context

Desktop nodes currently connect as regular clients with self-declared capabilities.
There is no explicit pairing step, no operator approval, and no mechanism to revoke
a device's access or scope its capabilities independently. Zod schemas for node
pairing exist in `packages/schemas/src/node.ts` (NodePairingRequest,
NodePairingStatus, NodePairingResolution) and `approval.ts` includes a `"pairing"`
approval kind, but no gateway runtime implements the flow.

The gap analysis (ARI-007) identifies this as high risk because nodes are the
isolation boundary for device automation and pairing is core to least privilege.

## Decision

Introduce an explicit pairing flow for nodes connecting with `role: node`.

**Connection flow**:
1. Node connects via WebSocket with `role: node` in `connect.init` (requires
   protocol rev >= 2 from ADR-001).
2. If the node's `device_id` is not yet paired, the gateway creates a pairing
   request with status `pending` and notifies the operator via WS event and/or
   HTTP endpoint.
3. The operator approves or denies the pairing request. On approval, the operator
   assigns scoped capabilities to the node.
4. The node receives confirmation and can begin operating within its granted scope.

**Revocation**: An operator can revoke a node at any time. Revocation immediately
disconnects the node and invalidates its pairing record. Revoked nodes that
reconnect see their pairing status as `revoked` and are denied.

**Capability scoping**: Paired node capabilities are stored in a
`node_capabilities` table, scoped per `device_id`. The gateway enforces these
capabilities when routing tasks to the node, replacing the current
client-declared capability model for paired nodes.

**Feature flag**: `TYRUM_NODE_PAIRING` (default off). When off, nodes connect
using the existing client-capability model. When on, `role: node` connections
require pairing approval before receiving tasks.

## Consequences

### Positive
- Stronger device isolation: each node has operator-approved, scoped capabilities.
- Immediate revocation prevents compromised devices from continuing to execute.
- Audit trail of pairing decisions ties device identity to operator approval.
- Builds on the cryptographic device identity from ADR-001.

### Negative
- Desktop app must be updated to connect as `role: node` with the pairing flow.
- Operators must approve each new node, adding an onboarding step.
- Dual capability models (client-declared vs node-scoped) coexist during migration.

### Risks
- If `TYRUM_NODE_PAIRING` is enabled before desktop clients are updated, nodes
  will be unable to connect. Mitigated by: feature flag defaults to off; desktop
  update ships before flag is enabled.
- Operator fatigue from too many pairing requests in large deployments. Mitigated
  by: auto-approve rules for known device_id prefixes (future enhancement, not
  in initial scope).
