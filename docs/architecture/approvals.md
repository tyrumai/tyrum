# Approvals

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
- **Durable side effects:** engine resume/cancel is driven by a leased, durable action queue so retries and multi-instance deployments do not duplicate side effects.
- **At-least-once events:** `approval.requested` / `approval.resolved` events may be delivered more than once; clients should dedupe using event ids. Re-emission of the same `approval.resolved` transition reuses the persisted `event_id`.

## Interfaces

Approvals are exposed over:

- WebSocket requests/responses plus server-push events (for real-time operator clients)
- HTTP APIs (for automation and operational tooling)

## Scoping

Approvals are scoped to durable identifiers, including `tenant_id`, `approval_id`, and execution scope (`run_id`, `step_id`, `attempt_id`) plus agent/session identifiers where applicable.

## Approval request shape

An approval request should be explicit about impact and traceability:

- `approval_id`
- `prompt` (operator-facing)
- `kind` (`spend`, `pii`, `workflow_step`, `pairing`, …)
- `scope` (agent/session/run/step identifiers)
- `risk` and `estimated_cost` (when applicable)
- `items_preview` (capped, optional)
- `suggested_overrides` (optional; bounded list of safe “approve always” patterns for tool-policy approvals)
- `expires_at`
- `resume_token` (when the approval gates a paused workflow)

## Resolution

Resolutions are durable records:

- `outcome` (`approved`, `denied`, or `expired`)
- `resolved_at`
- `resolved_by` (tenant membership / user identity / client device identity)
- optional `reason` (operator-provided)
- optional `mode` (`once` or `always`, only meaningful when `outcome=approved`)
- optional `policy_override_id` (when `mode=always` creates a durable policy override)

Expired approvals behave like denial unless explicitly configured otherwise.

## Approve once vs approve always

Approvals should support three operator outcomes:

- **Approve once:** resolve the pending approval and resume/cancel the waiting run as normal. No standing authorization is created.
- **Approve always:** resolve the pending approval and also create a **durable policy override** that allows _future_ matching actions without prompting. “Always” should be offered only when the approval includes `suggested_overrides` (or when a domain-specific durable authorization exists, such as node pairing).
- **Reject:** deny the pending approval (or let it expire), and cancel/keep paused according to policy.

“Approve always” is **enforcement**, not convenience: the override is a durable, auditable record with explicit scope and revocation. See [Policy overrides](./policy-overrides.md).

## Suggested overrides (pattern suggestions)

For tool-policy approvals, the gateway should include `suggested_overrides` so operator clients can offer an “always” option without free-form rule authoring.

Each suggested override is a _tool-specific wildcard pattern_ over a well-defined match target (see [Tools](./tools.md)). Suggestions are conservative:

- narrow scope by default (agent and workspace scoped where applicable)
- prefer prefix patterns over broad wildcards
- never suggest a rule that would bypass an explicit `deny`
- for automation schedules, prefer exact normalized heartbeat-create targets over free-form cadence or instruction text

## Integration with workflows (pause/resume)

When a workflow step requires approval:

- The execution engine pauses the run.
- An approval request is created with a **resume token** referencing the paused state.
- On approval resolution, the execution engine resumes/cancels the run **without re-running** completed steps.

## Events

Approvals should be observable via gateway-emitted events:

- `approval.requested`
- `approval.resolved`
- `policy_override.created` (when `mode=always` creates an override)
- `policy_override.revoked` / `policy_override.expired`
- `run.paused` (with reason: approval)
- `run.resumed`
- `run.cancelled` (when denied/expired)

## Client/UI expectations

The control panel should expose:

- An **approval queue** (filterable by agent/run/kind)
- Approval details (prompt, preview, linked evidence/artifacts)
- Approve **once** / approve **always** / deny with clear consequences
- “Always” UI that presents the bounded `suggested_overrides` list (scope + match target + pattern) and requires selecting one or more suggestions
- A policy override inventory (list/describe/revoke) with links back to the approvals and runs that created each override
- Deep links from notifications into the approval detail view
