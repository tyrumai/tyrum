# ADR-001: Protocol Revision Strategy

**Status**: Accepted
**Date**: 2026-02-20

## Context

The WebSocket protocol currently has no versioning mechanism. The gateway hardcodes
`tyrum-v1` as the subprotocol (`routes/ws.ts:26`) and the handshake is a simple
`WsConnectRequest` carrying `{capabilities, client_id?}` with no device identity
or cryptographic proof. This means:

- No way to evolve the protocol without breaking existing clients.
- No stable device identity for audit trails or key revocation.
- No mechanism to deprecate legacy message types safely.

The gap analysis (ARI-006) rates this as high risk because device identity, audit,
and presence all depend on a versioned handshake with cryptographic binding.

## Decision

Introduce protocol revision negotiation via the WebSocket subprotocol header and
a two-phase handshake for new revisions.

**Subprotocol header**: Clients advertise `tyrum-v2` (or higher) alongside the
existing `tyrum-auth.<token>` subprotocol. The gateway selects the highest
mutually supported revision.

**New handshake (rev >= 2)**:
1. Client sends `connect.init` containing `device_id` (derived from a local
   keypair), `protocol_rev`, `capabilities`, and a `nonce`.
2. Gateway replies with a server `challenge`.
3. Client sends `connect.proof` with a signature over `nonce || challenge` using
   the device private key.
4. Gateway verifies the signature, registers the device identity, and confirms
   the connection.

**Dual-stack migration**: The gateway accepts both legacy `connect` (rev 1) and
the new `connect.init`/`connect.proof` flow concurrently. A feature flag
`TYRUM_STRICT_HANDSHAKE` (default off) enforces new-only mode after telemetry
confirms sufficient client adoption.

**Revision registry**: A `PROTOCOL_REVISIONS` map in schemas defines the minimum
and maximum supported revisions, enabling the gateway to reject unsupported
clients with a clear error.

## Consequences

### Positive
- Enables stable, cryptographic device identity for audit, presence, and revocation.
- Protocol can evolve incrementally; each revision is self-describing.
- Dual-stack avoids big-bang client migration.
- `TYRUM_STRICT_HANDSHAKE` provides a clean cutover mechanism once legacy traffic drops to zero.

### Negative
- Dual-stack adds code paths that must be tested and maintained during migration.
- Desktop and CLI clients must implement keypair generation and the proof flow.
- Legacy clients that never upgrade will eventually be denied when strict mode is enabled.

### Risks
- Key management on the client side introduces UX complexity (key backup, re-pairing).
- Timing of strict enforcement depends on accurate adoption telemetry; premature
  enforcement breaks lagging clients.
- Mitigated by: observe-mode telemetry, per-client rev logging, gradual rollout
  of `TYRUM_STRICT_HANDSHAKE`.
