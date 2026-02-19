# Playbooks (deterministic workflows)

Status:

A playbook is a **durable, reviewable workflow artifact** that the execution engine can run deterministically. Playbooks exist to make multi-step work:

- **Composable:** a single run request executes many steps
- **Auditable:** steps and outcomes are logged with artifacts
- **Safe:** side effects are gated by approvals; runs can pause and resume
- **Resumable:** paused workflows can continue later without repeating completed steps

## Playbooks are not skills

- **Skills** are instruction bundles for the model (guidance).
- **Playbooks** are schema-validated workflow specs executed by the runtime (control).

## Workflow runtime contract (run / resume)

The playbook runtime exposes a small contract that supports two operations:

- **Run:** start a workflow.
- **Resume:** continue a paused workflow using a resume token.

### Input shape (conceptual)

```json
{
  "action": "run",
  "pipeline": "<inline pipeline string OR absolute playbook file path>",
  "argsJson": "{\"key\":\"value\"}",
  "cwd": "<workspace-relative cwd>",
  "timeoutMs": 30000,
  "maxOutputBytes": 512000
}
```

Resume:

```json
{
  "action": "resume",
  "token": "<resumeToken>",
  "approve": true
}
```

### Output envelope (conceptual)

The runtime returns an envelope with a **status**:

- `ok` → finished successfully
- `needs_approval` → paused; a `resumeToken` is required to resume
- `cancelled` → explicitly denied/cancelled (no further side effects)

Example (paused):

```json
{
  "ok": true,
  "status": "needs_approval",
  "output": [],
  "requiresApproval": {
    "prompt": "Apply changes?",
    "items": [],
    "resumeToken": "..."
  }
}
```

Failures should be represented as `ok: false` with a structured error payload (and may include partial output and/or a resume token when safe).

## Workflow files (YAML/JSON)

Playbooks can be stored as workflow files that define `name`, `args`, and `steps`. A minimal YAML shape:

```yaml
name: inbox-triage
args:
  tag:
    default: "family"
steps:
  - id: collect
    command: inbox list --json
  - id: categorize
    command: inbox categorize --json
    stdin: $collect.stdout
  - id: approve
    command: inbox apply --approve
    stdin: $categorize.stdout
    approval: required
  - id: execute
    command: inbox apply --execute
    stdin: $categorize.stdout
    condition: $approve.approved
```

### Step data passing

Steps can reference prior step outputs, for example:

- `stdin: $stepId.stdout` (raw output)
- `stdin: $stepId.json` (parsed JSON output)

The runtime is responsible for enforcing output caps and for refusing ambiguous/non-JSON output when a step declares JSON.

### Approval gates

Any step may declare `approval: required`. When reached:

- The run **pauses** and creates an approval request.
- The runtime returns/emits an envelope with `status: needs_approval` and a `resumeToken`.
- The operator approves/denies; the runtime resumes/cancels accordingly.

Approval steps can include a preview derived from prior step output (capped) so the operator sees what would happen before approving.

## Determinism + safety constraints

The playbook runtime must enforce:

- **Timeouts** (`timeoutMs`) and **output caps** (`maxOutputBytes`) at runtime.
- **Workspace boundary** for `cwd` (no filesystem traversal outside workspace).
- **Tool allowlists/denylists** and sandbox policy (no bypass via playbooks).
- **No secret values** embedded in workflow specs; use secret handles via the secret provider.
- **Postconditions** for state-changing steps when feasible.

## Optional: JSON-only LLM steps

Some workflows need a constrained “judgment” step (classify, extract, draft) without giving the model general tool access. The workflow runtime may support an optional step kind that:

- accepts `{ prompt, input, schema }`
- runs a model with **JSON-only output**
- validates output against `schema`
- exposes **no tools** during the call

This keeps workflows predictable while still allowing narrow LLM assistance.

