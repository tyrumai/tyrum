# ADR 0002: PolicyBundle, snapshots, and policy overrides

- Status: Accepted
- Date: 2026-02-21

## Context

Target architecture requires deterministic, declarative enforcement via a merged `PolicyBundle` with:

- precedence (deployment → agent → playbook)
- per-run policy snapshots (durable reference + hash)
- operator-created policy overrides (“approve always”) that can relax `require_approval → allow` and do **not** override explicit `deny` by default

Current code has a small in-process policy engine and no bundle/snapshot/override layer.

## Decision

1. Introduce a versioned `PolicyBundle` contract (YAML/JSON) covering minimum domains:
   - tools
   - network egress
   - secrets resolution
   - messaging/connectors
   - artifacts
   - provenance rules (minimal initial hooks)
2. Persist merged effective policy as a **snapshot** when creating durable work:
   - `policy_snapshot_id` + `sha256` hash of canonical JSON form
3. Add a durable `policy_overrides` table:
   - wildcard match (`*` / `?`) per tool-defined match target
   - scope at least to `agent_id` (and optionally `workspace_id`)
4. Apply overrides only when the baseline decision is `require_approval`:
   - `deny` always wins by default

## Rationale

- Storing policy as data makes enforcement reproducible and auditable.
- Snapshot references make “why was this allowed?” answerable after the fact.
- Overrides reduce repeated approvals without weakening deny-by-default posture.

## Consequences

- Policy evaluation becomes: merge bundle layers → evaluate → apply overrides (if eligible).
- Policy snapshots become part of execution/job/run records and exports.
- Enforcement can be rolled out domain-by-domain behind feature flags.

## Rollout / rollback

- Rollout: start in observe-only (log decisions + would-apply overrides), then enforce specific domains with flags.
- Rollback: disable enforcement flags; keep snapshot/override persistence additive.

