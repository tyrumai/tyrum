# ADR 0001: WS protocol revisions and dual-stack handshake

- Status: Accepted
- Date: 2026-02-21

## Context

Target architecture requires:

- WebSocket-first control plane
- protocol revision gating (`protocol_rev`)
- stable device identity via public-key proof (`connect.init` / `connect.proof`)

The repo currently supports a single-message legacy handshake (`connect`) and uses WS mainly for capability dispatch.

We need to introduce the target handshake without breaking existing clients and while preserving the default auth model (gateway token via WS subprotocol metadata).

## Decision

1. Keep the WS **major** protocol identifier as `tyrum-v1` for now.
2. Add **protocol revision gating** as an integer `protocol_rev` in `connect.init.payload`.
3. Implement a dual-stack handshake:
   - Legacy: `connect` (supported during a deprecation window)
   - vNext: `connect.init` → `connect.proof`
4. Gate strict `protocol_rev` enforcement behind a feature flag:
   - Observe-only by default (accept mismatches but emit events/logs)
   - Enforce when enabled (reject mismatches during handshake)

## Rationale

- The token auth scheme is already deployed (`tyrum-auth.<base64url(token)>`) and should remain unchanged.
- Using a revision integer allows evolving request types and fields without a major-version bump.
- Dual-stack support enables safe, incremental rollout across desktop/web clients.

## Consequences

- Gateway WS handler becomes a small handshake state machine (legacy vs vNext).
- Presence and pairing can key off stable device identity once vNext handshake is used.
- Clients must learn vNext handshake but can fall back to legacy during rollout.

## Rollout / rollback

- Rollout: ship dual-stack; enable observe-only revision logging; gradually enable strict revision enforcement.
- Rollback: disable strict revision enforcement and continue accepting legacy `connect`.

