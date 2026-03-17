---
slug: /architecture/playbooks
---

# Playbooks (deterministic workflows)

A playbook is a durable workflow spec executed by the runtime, not by prompt memory. It gives Tyrum a reviewable run graph with deterministic pause/resume behavior.

## Quick orientation

- Read this if: you need the control flow for multi-step deterministic work.
- Skip this if: you need tool-level runtime mechanics or queue internals.
- Go deeper: [Execution engine](/architecture/execution-engine), [Approvals](/architecture/approvals), [Automation](/architecture/automation).

## Run -> pause -> resume flow

```mermaid
flowchart TB
  RunReq["workflow.run"] --> Parse["Load + validate playbook"]
  Parse --> Start["Start run in execution engine"]
  Start --> Step["Execute next step"]
  Step --> NeedsApproval{"approval required?"}
  NeedsApproval -- no --> More{"more steps?"}
  NeedsApproval -- yes --> Pause["Pause run + create approval + issue resume token"]
  Pause --> Decision{"approved?"}
  Decision -- yes --> Resume["workflow.resume(token)"]
  Decision -- no --> Cancel["Cancel / hold per policy"]
  Resume --> Step
  More -- yes --> Step
  More -- no --> Done["Run completed"]
```

Playbooks are about control-plane determinism: each step is typed, bounded, and auditable.

## What playbooks are for

- composing many side-effecting or read-only steps into one run
- pausing safely for approvals and resuming without replaying completed steps
- preserving evidence and outcomes per step/attempt
- expressing workflow behavior as data (YAML/JSON), not ad hoc model decisions

Playbooks are not skills. Skills are instruction/context bundles; playbooks are runtime-enforced workflow specs.

## Runtime contract (minimal)

The surface is intentionally small:

- `workflow.run`: start a run from inline pipeline, loaded id, or loaded file path
- `workflow.resume`: continue a paused run by `resumeToken`
- `workflow.cancel`: stop queued/running/paused work under policy rules

Common run inputs include `cwd`, `timeoutMs`, and `maxOutputBytes`. Output is a status envelope: `ok`, `needs_approval`, `cancelled`, or `error`.

## Workflow shape

A playbook defines `name`, optional `args`, and ordered `steps`.

Step commands use explicit namespaces so execution is unambiguous:

- `cli`, `http`, `web`, `mcp`, `node`
- `llm` for JSON-only model steps with explicit tool budget and allowlist

Steps can consume prior outputs (`$stepId.stdout` / `$stepId.json`), and JSON-declared outputs are validated as JSON contracts.

## Approval behavior

Any step can declare `approval: required`.

- execution pauses before side effects
- an approval record is created with bounded preview context when available
- resume requires a durable token and explicit decision
- denied/expired paths cancel or hold according to policy

This keeps long workflows safe under restarts, retries, and multi-instance execution.

## Safety constraints (non-negotiable)

- enforce step timeouts and output caps
- enforce workspace boundary for `cwd`
- enforce tool policy and sandbox rules for every step
- use secret handles instead of embedding raw secret values
- require postconditions for state-changing steps when feasible

## LLM steps in deterministic workflows

LLM steps are allowed as bounded judgment/extraction stages, but they remain runtime-governed:

- explicit model and JSON output schema
- explicit tool allowlist (if tools are allowed)
- max tool call count and runtime budgets
- normal policy and approval gates still apply

## Related docs

- [Execution engine](/architecture/execution-engine)
- [Approvals](/architecture/approvals)
- [Automation](/architecture/automation)
- [Tools](/architecture/tools)
