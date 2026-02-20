# Policy overrides (approve-always)

Policy overrides are durable, operator-created enforcement rules that reduce repeated prompts without weakening Tyrum’s auditability or safety model.

They are most commonly created when an operator resolves an approval with **approve always** (see [Approvals](./approvals.md)).

## What a policy override is (and is not)

- **Is:** a durable, auditable rule that can turn a future `require_approval` decision into an `allow` decision for *matching* tool actions.
- **Is not:** prompt text, a “hint”, or an implicit trust signal. Overrides are evaluated by the policy engine and recorded in the audit log.

## Scope and safety invariants

Policy overrides are scoped and conservative by default:

- scoped at least to `agent_id` (and typically also `workspace_id` for workspace-backed tools)
- **cannot** override an explicit `deny` by default
- intended to relax only `require_approval → allow`

If a deployment needs “deny overrides”, it must be an explicit, audited, policy-gated exception and should be avoided.

## Relationship to PolicyBundle

The baseline enforcement configuration is the merged `PolicyBundle` (deployment + agent + playbook). Policy overrides form an additional, operator-controlled layer applied during policy evaluation. See [Sandbox and policy](./sandbox-policy.md).

## Matching and pattern language

Overrides use **tool-specific wildcard patterns** matched against a well-defined per-tool “match target”.

Wildcard grammar:

- `*` matches zero or more characters
- `?` matches exactly one character

No regex by default.

Each override stores:

- `tool_id` (the tool the pattern applies to)
- `pattern` (wildcard pattern over that tool’s match target)

Tools must define their match targets unambiguously (examples live in [Tools](./tools.md)).

## Evaluation semantics

Policy evaluation remains deterministic and conservative:

1. Evaluate merged `PolicyBundle` layers (deployment → agent → playbook) to produce `allow | deny | require_approval`.
2. If the result is `deny`, return `deny` (overrides do not apply).
3. If the result is `allow`, return `allow`.
4. If the result is `require_approval`, check for a matching **active** policy override:
   - if a match exists, return `allow` and include the applied `policy_override_id`(s) in the decision record
   - otherwise return `require_approval` as normal

## Data model (durable records)

Policy overrides are durable records separate from approvals. A minimal record shape:

- `policy_override_id`
- `status` (`active`, `revoked`, `expired`)
- `created_at`, `created_by` (user identity + client identity)
- `agent_id`
- optional `workspace_id` (recommended for workspace-backed tools)
- `tool_id`
- `pattern`
- `created_from_approval_id` (link back to the originating approval)
- `created_from_policy_snapshot_id` (link back to the policy snapshot in effect when the approval was requested)
- optional `expires_at`
- optional `revoked_at`, `revoked_by`, `revoked_reason`

## Audit, events, and export

Overrides are first-class audit objects:

- Creation emits `policy_override.created` with the durable `policy_override_id` and linkage fields.
- Revocation emits `policy_override.revoked`.
- Expiry emits `policy_override.expired`.

Policy decision records (and run logs) should include which override ids were applied so operators can answer “why was this allowed?” after the fact.

Snapshot exports should include:

- approval records (requested/resolved)
- policy override records (active + historical with status)
- audit/event logs linking `approval_id`, `policy_snapshot_id`, and `policy_override_id`

## Operator UX expectations

Operator clients should provide:

- Override inventory (filter by agent/tool/status)
- Override detail view (match target description, pattern, scope, created-from approval/run)
- One-tap revoke with an operator-provided reason (revocation is audited)

Suggested control-plane commands: see [Slash commands](./slash-commands.md).
