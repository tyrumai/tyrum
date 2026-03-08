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

### Provenance rule (v1)

A conservative provenance rule is:

- `PolicyBundle.provenance.untrusted_shell_requires_approval` escalates `tool.exec` from `allow → require_approval` when enabled and when the tool call is driven by untrusted-input provenance.

Operators can relax this behavior by setting `provenance.untrusted_shell_requires_approval: false` in policy bundles (deployment/agent/playbook). For narrow exceptions, prefer `approve always` policy overrides on stable tool match targets rather than broad allowlists.

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
4. **Operator policy overrides** (durable “approve always” edits created via approvals; see [Policy overrides](./policy-overrides.md))

Conflict resolution is conservative:

- `deny` wins over `require_approval` wins over `allow`.
- Narrower scopes may tighten constraints.
- Widening constraints must be explicit and auditable. Operator policy overrides are the standard mechanism for turning `require_approval → allow` for a narrow, tool-scoped pattern. Overrides must not bypass explicit `deny` by default.

## Policy snapshots

Every execution run carries the effective policy as a snapshot reference:

- The gateway persists a `policy_snapshot_id` and a content hash for the merged policy used to create the run.
- Exports and audits reference the snapshot so policy decisions remain explainable and replayable.
- Policy decisions may also record applied `policy_override_id` values when an operator override turns `require_approval → allow`. This keeps “why was this allowed?” answerable without weakening the conservative `deny` precedence.

### Snapshot hashing (canonical form hard rule)

The snapshot hash MUST be computed over a deterministic canonical representation of the merged policy (for example RFC 8785 JSON Canonicalization Scheme or an equivalent canonical JSON encoder). This ensures:

- the same policy always yields the same hash across processes/languages,
- exports/imports can validate integrity reliably, and
- audits can prove exactly which policy content produced a decision.

Store (or be able to re-derive) the canonical bytes used to compute the hash for verification during export/import.

### Executor fail-closed contract

Executors must enforce policy from the run snapshot, not assume a caller already did it:

- execution entry points must receive valid tenant scope plus the run `policy_snapshot_id` before running policy-governed actions
- executor-side secret resolution must happen only after snapshot-based policy allows it
- executor-side tool and egress denials must fail closed even if an alternate path bypasses queue-time checks
- executor-generated policy approvals and denials must stay auditable through the normal run/step/attempt records

This keeps standalone toolrunner execution, local execution, and queued workflow execution aligned on the same policy boundary.

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

## Sandbox hardening profiles

Tyrum exposes a simple **sandbox hardening profile** concept so operators and the model can reason about the runtime containment posture.

Profiles:

- **`baseline`** (default): conservative process/container defaults (non-root, reduced ambient privilege) plus workspace boundary checks and environment sanitization.
- **`hardened`** (opt-in): baseline plus additional container hardening such as read-only root filesystem and tighter pod/process settings in ToolRunner sandboxes.

### Configuration

The hardening profile is deployment-configurable:

- `baseline` (default)
- `hardened`

In containerized deployments, the gateway uses this profile to harden ToolRunner job/pod specs. In local-subprocess deployments, the value is treated as **operator-provided signaling** (the runtime cannot reliably detect host/container hardening automatically).

### Observability and signaling

- `/status` includes `sandbox.hardening_profile`.
- The agent system prompt includes a **Sandbox** section (hardening profile + elevated-execution availability) so the model does not need to guess.

## Auditability

Policy decisions and sandbox denials are observable:

- policy evaluation results (decision + reasons + snapshot reference) are attached to run/step/attempt records where relevant
- significant enforcement actions emit events suitable for operator UIs and export
