# Approvals

Status:

Approvals are Tyrum’s durable mechanism for gating risky or side-effecting actions behind explicit operator consent. They are created by policy checks and by the execution engine when a workflow step requires confirmation.

Approvals are **enforcement**, not prompt guidance.

## What approvals are used for

- Spending / commitments
- External messaging to new parties
- Accessing sensitive scopes (filesystem, shell, secrets, remote nodes)
- Executing side-effecting workflow steps (playbooks)
- Human takeover handoffs (pause-and-drive)
- Device/node pairing (when required)

## Approval lifecycle

1. **Requested:** the gateway persists an approval request and emits an event.
2. **Resolved:** an operator approves/denies (or it expires).
3. **Applied:** the waiting workflow/run resumes, cancels, or escalates.

Approvals must be safe to process more than once (idempotent resolution handling).

## Cluster notes

Approvals are durable records in the StateStore and should behave correctly when multiple gateway instances (and multiple operator clients) are active:

- **Any gateway edge instance can serve the approval queue** (read from the StateStore) and accept resolution requests.
- **Atomic resolution:** apply `pending → approved|denied|expired` transitions in a single durable write so double-submission is safe.
- **At-least-once events:** `approval.requested` / `approval.resolved` events may be delivered more than once; clients should dedupe using event ids.

## Approval request shape (conceptual)

An approval request should be explicit about impact and traceability:

- `approval_id`
- `prompt` (operator-facing)
- `kind` (`spend`, `pii`, `workflow_step`, `pairing`, …)
- `scope` (agent/session/run/step identifiers)
- `risk` and `estimated_cost` (when applicable)
- `items_preview` (capped, optional)
- `expires_at`
- `resume_token` (when the approval gates a paused workflow)

## Resolution

Resolutions are durable records:

- `approved: boolean`
- `resolved_at`
- `resolved_by` (client identity / user identity)
- optional `reason` (operator-provided)

Expired approvals behave like denial unless explicitly configured otherwise.

## Integration with workflows (pause/resume)

When a workflow step requires approval:

- The execution engine pauses the run.
- An approval request is created with a **resume token** referencing the paused state.
- On approval resolution, the execution engine resumes/cancels the run **without re-running** completed steps.

## Events (conceptual)

Approvals should be observable via gateway-emitted events:

- `approval.requested`
- `approval.resolved`
- `run.paused` (with reason: approval)
- `run.resumed`
- `run.cancelled` (when denied/expired)

## Client/UI expectations

The control panel should expose:

- An **approval queue** (filterable by agent/run/kind)
- Approval details (prompt, preview, linked evidence/artifacts)
- One-tap approve/deny with clear consequences
- Deep links from notifications into the approval detail view

