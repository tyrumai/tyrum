---
slug: /architecture/gateway/reviews
---

# Reviews

Reviews are the gateway-owned decision pipeline that evaluates approvals and node pairings before a final human or system resolution is applied.

## Purpose

This component exists so Tyrum can run guardian-first review for risky items without turning approvals and pairings into prompt-only workflows.

Reviews keep three concerns separate:

- the operator-facing queue state on approvals and pairings,
- the durable audit record of each reviewer pass, and
- the final resolution that the execution engine or pairing system applies.

## Responsibilities

- Initialize approval and pairing review state from policy.
- Persist durable `review_entries` records for guardian, human, and system reviewers.
- Run guardian review work and update parent approval/pairing status safely.
- Fall back to human review when guardian review fails, times out, or asks for escalation.

## Non-goals

- Reviews do not replace approvals or pairings as the durable records operators act on.
- Reviews do not directly execute workflow side effects; the execution engine and pairing lifecycle apply those results.

## Boundary and ownership

- **Inside the boundary:** review initialization, guardian work claiming, reviewer subagent orchestration, timeout handling, and audit persistence.
- **Outside the boundary:** execution resume/cancel behavior, node capability dispatch, and operator UI rendering.

## Inputs, outputs, and dependencies

- **Inputs:** new approvals, new node-pairing requests, policy bundle review mode, guardian reviewer results, and human/operator decisions.
- **Outputs:** approval or pairing status transitions, `review_entries`, and `approval.updated` or `pairing.updated` events.
- **Dependencies:** [Gateway](/architecture/gateway), [Approvals](/architecture/approvals), policy loading, execution resume logic, node pairing DAL, and protocol event delivery.

## State and data

- Parent approvals and node pairings expose operator-facing statuses such as `queued`, `reviewing`, `awaiting_human`, `approved`, and `denied`.
- `review_entries` record reviewer metadata separately with `target_type`, `reviewer_kind`, `state`, evidence, decision payload, and lifecycle timestamps.
- Review entry states are more detailed than parent status and include `queued`, `running`, `requested_human`, `approved`, `denied`, `failed`, and other audit states.
- The effective policy decides whether new work starts in `auto_review` mode or `manual_only`.

## Control flow

1. The gateway creates an approval or pairing and looks up the effective review mode.
2. `auto_review` starts the parent object in `queued` with a guardian review entry; `manual_only` starts it in `awaiting_human` with a system review entry requesting human action.
3. The guardian review processor claims `queued` items, moves the parent status to `reviewing`, and runs a reviewer subagent.
4. If the guardian approves, the parent object resolves to `approved` and the normal approval or pairing side effects are applied.
5. If the guardian asks for escalation, fails, or times out, the parent object moves to `awaiting_human` and a human operator resolves it from the ordinary queue.

## Invariants and constraints

- Every reviewable approval or pairing should carry `latest_review` state once initialized.
- Review processing must be safe under retries and concurrent gateway instances; status transitions are the claim boundary.
- Guardian review is advisory until it produces a durable approval or denial on the parent object.
- There is no separate public review event stream; parent approval/pairing events remain the operator-facing contract.

## Failure behavior

- **Expected failures:** reviewer subagent errors, stale guardian claims, policy lookup failures, and gateway restarts during review.
- **Recovery path:** policy lookup falls back to guardian-first defaults, review claims are retried through durable state, and stale `reviewing` items are moved to `awaiting_human` so operators can finish them safely.

## Security and policy considerations

- Review decisions stay tenant-scoped and auditable.
- Guardian review does not bypass approval, pairing, or capability allowlist enforcement.
- Human review remains the safe fallback whenever automation cannot justify a terminal decision.

## Key decisions and tradeoffs

- **Keep review state attached to parent objects:** operators observe approvals and pairings directly instead of learning a second queue abstraction.
- **Separate audit detail from queue state:** `review_entries` preserve reviewer evidence and failure modes without overloading the parent status enum.

## Observability

- `approval.updated` and `pairing.updated` carry review-progress states and `latest_review`.
- `review_entries` provide the durable audit trail for guardian, human, and system reviewer passes.
- Timeout and escalation paths remain visible as ordinary parent status transitions instead of hidden internal retries.

## Related docs

- [Gateway](/architecture/gateway)
- [Approvals](/architecture/approvals)
- [Events](/architecture/protocol/events)
- [Gateway data model map](/architecture/data-model-map)
- [Data lifecycle and retention](/architecture/data-lifecycle)
