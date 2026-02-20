# Sandbox and Policy

Tyrum enforces safety through layered controls that do not depend on prompt text alone. Policies, approvals, and sandboxing define what execution is allowed to do.

## Enforcement layers

- **Contracts:** schema validation at trust boundaries.
- **Tool policy:** allowlists/denylists and per-tool parameter validation.
- **Approvals:** explicit human confirmation for risky actions.
- **Sandboxing:** runtime constraints that limit filesystem/network/process access.
- **Channel/connector policy:** explicit enabling and scoping of external connectors.

## Advisory vs enforcement

- Prompts and skills can guide behavior.
- Policies, approvals, and sandboxing must enforce behavior.

## Provenance and injection defense

Tyrum treats untrusted content as data. Inputs from tools, web pages, channels, and external connectors are tagged with provenance and are not interpreted as executable instructions.

Policy rules can depend on provenance (for example: “deny shell when the input originated from web content”, or “require approval before sending an outbound message derived from an untrusted source”).

## Policy bundle

Policy is represented as a declarative, versioned configuration bundle (`PolicyBundle`) stored as data (YAML/JSON) and validated like other contracts.

Policy evaluation is deterministic and produces one of:

- `allow`
- `deny`
- `require_approval`

The result includes structured reasons suitable for UI display and audit logs.

## Composition and precedence

Effective policy is the merged result of:

1. **Deployment policy** (global defaults)
2. **Agent policy** (agent-scoped overrides)
3. **Playbook policy** (workflow-scoped overrides)

Conflict resolution is conservative:

- `deny` wins over `require_approval` wins over `allow`.
- Narrower scopes may tighten constraints; widening constraints requires an explicit, auditable mechanism (for example an approval-gated override rule).

## Policy snapshots

Every execution run carries the effective policy as a snapshot reference:

- The gateway persists a `policy_snapshot_id` and a content hash for the merged policy used to create the run.
- Exports and audits reference the snapshot so policy decisions remain explainable and replayable.

## Minimum policy domains

A `PolicyBundle` covers at minimum:

- **Tool policy:** tool allow/deny plus parameter constraints (including workspace boundary rules).
- **Network egress:** default-deny with explicit allowlists and approval-gated overrides.
- **Secrets:** handle resolution permissions and injection constraints.
- **Messaging/connectors:** connector enablement and scope constraints.
- **Artifacts:** retention defaults and artifact fetch authorization hooks.
- **Provenance rules:** policy decisions based on input provenance.

## Sandboxing baseline

Sandboxing is the runtime enforcement layer that limits what executors can do even when policy allows an action:

- workspace boundary enforcement (no traversal outside the workspace mount)
- least-privilege process/container defaults (no ambient host access)
- optional hardened mode (seccomp/AppArmor/container restrictions) for high-risk deployments

## Auditability

Policy decisions and sandbox denials are observable:

- policy evaluation results (decision + reasons + snapshot reference) are attached to run/step/attempt records where relevant
- significant enforcement actions emit events suitable for operator UIs and export
