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

Each rule in a PolicyBundle specifies:

- `domain`: one of egress, secrets, messaging, tools, artifacts (extensible).
- `action`: deny | require_approval | allow.
- `conditions`: optional predicates (scope patterns, amount thresholds, PII categories).
- `priority`: integer for ordering within a domain.

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

## Minimum policy domains

A `PolicyBundle` covers at minimum:

- **Tool policy:** tool allow/deny plus parameter constraints (including workspace boundary rules).
- **Network egress:** default-deny with explicit allowlists and approval-gated overrides.
- **Secrets:** handle resolution permissions and injection constraints.
- **Messaging/connectors:** connector enablement and scope constraints.
- **Artifacts:** retention defaults and artifact fetch authorization hooks.
- **Provenance rules:** policy decisions based on input provenance.

### Rollout and migration

`TYRUM_POLICY_ENFORCE` (default off) enables enforcement per domain, allowing incremental activation. When off, the engine logs every policy decision but does not block actions (observe-only mode). Four built-in rules (spend_limit, pii_guardrail, legal_compliance, connector_scope) are expressed as a default deployment bundle, preserving existing behavior until enforcement is enabled.

## Sandboxing baseline

Sandboxing is the runtime enforcement layer that limits what executors can do even when policy allows an action:

- workspace boundary enforcement in `tool-executor.ts` (no traversal outside the workspace mount) — always active regardless of deployment target
- least-privilege process/container defaults (no ambient host access)

OS-level sandboxing (namespaces, seccomp, AppArmor) is a deployment concern. The gateway does not attempt to load seccomp filters or call `prctl(2)` at runtime. Instead, deployment manifests (Helm charts, Docker Compose, systemd units) apply appropriate restrictions.

### Reference security profiles

The Helm chart ships with secure defaults for the tool-runner deployment:

```yaml
securityContext:
  runAsNonRoot: true
  readOnlyRootFilesystem: true
  capabilities:
    drop: [ALL]
  seccompProfile:
    type: RuntimeDefault
```

AppArmor annotation for additional confinement:

```yaml
annotations:
  container.apparmor.security.beta.kubernetes.io/toolrunner: runtime/default
```

Operators are responsible for reviewing and adapting these profiles to their environment. Custom seccomp profiles with explicit syscall allowlists provide the strongest confinement for high-risk deployments.

## Auditability

Policy decisions and sandbox denials are observable:

- policy evaluation results (decision + reasons + snapshot reference) are attached to run/step/attempt records where relevant
- significant enforcement actions emit events suitable for operator UIs and export

## Design rationale

Declarative bundles decouple policy authoring from code deploys, allowing operators to tailor policy without redeploys. Deny-wins precedence prevents lower-priority scopes (playbook, agent) from weakening deployment-level security. Snapshot-at-run-start ensures audit can reconstruct which policies applied even after bundle updates. Observe-only mode reduces risk of accidental lockout during rollout. Misconfigured bundles could silently allow denied actions — mitigated by deny-wins semantics, observe-only mode, and bundle validation at load time.

Workspace path boundary enforcement is the application-layer first line of defense. OS-level sandboxing is layered on top as a deployment concern because deployment environments vary widely and container runtimes/orchestrators are best positioned to apply restrictions.
