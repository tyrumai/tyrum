# ADR-002: PolicyBundle Design

**Status**: Accepted
**Date**: 2026-02-20

## Context

The current policy engine (`modules/policy/engine.ts`) implements four hardcoded
rules: spend_limit, pii_guardrail, legal_compliance, and connector_scope. These
rules use fixed thresholds and scope lists that cannot be changed without a code
deploy. The architecture requires configurable, composable policies with clear
precedence across deployment, agent, and playbook scopes.

The gap analysis (ARI-014) identifies this as high risk because PolicyBundle is
the enforcement backbone for tools, egress, secrets, messaging, and artifacts.

## Decision

Introduce a **PolicyBundle** abstraction loaded from YAML or JSON files with
merge-based precedence.

**Precedence**: deployment > agent > playbook. A deployment-level bundle provides
the security floor. Agent-level bundles customize per agent. Playbook-level
bundles apply only for the duration of a workflow run. Merge is last-writer-wins
at the rule level, with higher-precedence layers overriding lower ones.

**Rule structure**: Each rule specifies:
- `domain`: one of egress, secrets, messaging, tools, artifacts (extensible).
- `action`: deny | require_approval | allow.
- `conditions`: optional predicates (scope patterns, amount thresholds, PII categories).
- `priority`: integer for ordering within a domain.

**Action precedence**: deny > require_approval > allow. If any matching rule
denies, the action is denied regardless of other rules.

**Snapshot at run start**: When an execution run begins, the resolved PolicyBundle
is snapshotted and stored with the run record. This ensures audit can reconstruct
exactly which policies applied, even if bundles are updated later.

**Observe-only rollout**: Start with observe-only mode where the engine logs every
policy decision but does not block actions. Feature flag `TYRUM_POLICY_ENFORCE`
(default off) enables enforcement per domain, allowing incremental activation as
confidence grows.

**Migration path**: The four existing hardcoded rules are expressed as a built-in
deployment bundle. No behavior changes until `TYRUM_POLICY_ENFORCE` is enabled.

## Consequences

### Positive
- Operators can tailor policy without code changes or redeploys.
- Precedence model prevents playbooks from weakening deployment-level security.
- Snapshots provide full audit trail of policy state at decision time.
- Observe-only mode reduces risk of accidental lockout during rollout.

### Negative
- Requires migration from hardcoded rules to bundle format.
- Bundle merge logic must be well-tested to avoid surprising precedence behavior.
- Operators must learn the bundle schema and precedence model.

### Risks
- Misconfigured bundles could silently allow actions that should be denied.
  Mitigated by: deny-wins precedence, observe-only mode, and bundle validation
  at load time.
- Bundle proliferation across many agents could become hard to audit. Mitigated
  by: deployment-level floor that applies universally, bundle diffing in tooling.
