---
slug: /architecture/sandbox-policy/enforcement-model
---

# Policy enforcement model

## Parent concept

- [Sandbox and Policy](/architecture/sandbox-policy)

## Scope

This page describes the exact enforcement path for Tyrum policy decisions: how policy bundles are merged, how decisions become execution-time checks, how overrides apply, and how the system fails closed when enforcement paths disagree.

## Evaluation pipeline

Policy evaluation follows a deterministic sequence:

1. validate the incoming request or tool invocation against contracts
2. load and merge the effective `PolicyBundle` from deployment, agent, and playbook scope
3. apply any narrow operator-created policy overrides
4. evaluate provenance-aware rules and tool-specific constraints
5. return `allow`, `deny`, or `require_approval` with structured reasons

The decision output is data, not prompt text.

## Merge and precedence rules

- `deny` wins over `require_approval`
- `require_approval` wins over `allow`
- narrower scopes may tighten behavior
- operator overrides may turn a narrow `require_approval` into `allow`, but must not silently bypass an explicit `deny`

This keeps broad defaults conservative while still allowing auditable exceptions.

## Snapshot enforcement

Execution uses the merged policy snapshot that was active when the run was created:

- the run stores `policy_snapshot_id` plus a deterministic content hash
- executors receive that snapshot reference before performing policy-governed actions
- approval records and override usage remain linked back to the same snapshot

This preserves replayability and answers “why was this allowed?” after the live configuration changes.

## Provenance-aware decisions

Untrusted content remains tagged as data throughout the runtime. Policy can escalate based on provenance, for example:

- require approval before `bash` when arguments derive from untrusted web content
- require approval before outbound messaging when message content derives from an untrusted source
- deny unsafe tool chaining even if each individual tool would otherwise be allowed

Provenance rules are part of enforcement, not advisory prompt guidance.

## Executor fail-closed behavior

Executors must enforce policy independently of queue-time checks:

- secret resolution happens only after snapshot-based policy allows it
- tool and network denials fail closed if an alternate path bypasses an earlier guard
- approvals created at execution time flow back into the standard durable approval path

This keeps local execution, ToolRunner execution, and queued workflow execution aligned.

## Override and approval boundary

`approve always` creates a durable override only when the approval includes safe, bounded suggestions:

- overrides match stable tool-specific targets
- override creation is auditable and revocable
- free-form broadening is intentionally avoided

The approval UI is the operator surface; the durable override record is the enforcement artifact.

## Auditability

Policy enforcement remains explainable through:

- decision reasons attached to runs, steps, and attempts
- `policy_snapshot_id` and canonical snapshot hash
- durable links from approvals to created overrides
- events for override creation, revocation, and expiry

## Related docs

- [Sandbox and Policy](/architecture/sandbox-policy)
- [Approvals](/architecture/approvals)
- [Policy overrides](/architecture/policy-overrides)
- [Tools](/architecture/tools)
- [Contracts](/architecture/contracts)
