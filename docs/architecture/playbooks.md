# Playbooks (deterministic workflows)

## Status

- **Status:** Implemented

A playbook is a **durable, reviewable workflow artifact** that the execution engine can run deterministically. Playbooks exist to make multi-step work:

- **Composable:** a single run request executes many steps
- **Auditable:** steps and outcomes are logged with artifacts
- **Safe:** side effects are gated by approvals; runs can pause and resume
- **Resumable:** paused workflows can continue without repeating completed steps

## Playbooks are not skills

- **Skills** are instruction bundles for the model (guidance).
- **Playbooks** are schema-validated workflow specs executed by the runtime (control).

## Workflow runtime contract (run / resume)

The playbook runtime exposes a small contract that supports two operations:

- **Run:** start a workflow.
- **Resume:** continue a paused workflow using a resume token.

### Input shape

```json
{
  "action": "run",
  "pipeline": "<inline pipeline YAML OR loaded playbook id OR absolute file path of a loaded playbook>",
  "argsJson": "{\"key\":\"value\"}",
  "cwd": "<workspace-relative cwd>",
  "timeoutMs": 30000,
  "maxOutputBytes": 512000
}
```

Notes:

- When `pipeline` is an absolute file path, it must refer to a playbook file already loaded by the gateway (typically under `TYRUM_HOME/playbooks`).
- `maxOutputBytes` is a positive integer cap applied by the runtime/executor to step output capture.
- When omitted, a safe default cap is applied.

Resume:

```json
{
  "action": "resume",
  "token": "<resumeToken>",
  "approve": true
}
```

### Output envelope

The runtime returns an envelope with a **status**:

- `ok` → finished successfully
- `needs_approval` → paused; a `resumeToken` is required to resume
- `cancelled` → explicitly denied/cancelled (no further side effects)
- `error` → failed; `ok: false` with a structured error payload

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
    command: cli inbox list --json
    output: json
  - id: categorize
    command: cli inbox categorize --json
    output: json
    stdin: $collect.stdout
  - id: approve
    command: cli inbox apply --approve
    stdin: $categorize.stdout
    approval: required
  - id: execute
    command: cli inbox apply --execute
    stdin: $categorize.stdout
    condition: $approve.approved
```

### Command namespaces (required)

`steps[].command` is interpreted via an explicit namespace prefix and compiled into typed runtime actions. This avoids unsafe implicit behavior (for example “shell by accident”).

Examples:

- `cli …` → command runs via the CLI capability/tooling (never an implicit OS shell).
- `http …` → HTTP request action.
- `web …` → browser automation action.
- `mcp …` → MCP tool invocation.
- `node …` → node RPC / capability call.
- `llm` → JSON-only model step (optionally with allowlisted tools + tool-call budgets).

### Step data passing

Steps can reference prior step outputs, for example:

- `stdin: $stepId.stdout` (raw output)
- `stdin: $stepId.json` (parsed JSON output)

The runtime is responsible for enforcing output caps and for refusing ambiguous/non-JSON output when a step declares JSON (via `output: json` and/or an explicit output schema).

If a step declares an explicit output schema, the output contract type must be JSON (for example `output: { type: json, schema: ... }`).

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

Some workflows need a “judgment” step (classify, extract, draft) that uses a model and may call tools. Tyrum allows LLM steps, but they must remain **budgeted** and **enforced** like any other execution:

- tool access must be explicitly allowed (allowlist / policy)
- risky tool calls may require approvals
- budgets/timeouts apply (including a maximum tool-call count)
- outputs should be validated when a schema is provided

This supports advanced workflows while keeping safety enforceable outside prompts.

### LLM step shape

LLM steps use the `llm` command namespace plus an `llm` config block. They must declare a JSON output contract.

```yaml
- id: extract
  command: llm
  llm:
    model: openai/gpt-4.1
    prompt: |
      Extract fields from the input and return JSON.
    max_tool_calls: 2
    tools:
      allow:
        - tool.http.fetch
        - tool.exec
  output:
    type: json
    schema:
      type: object
      properties:
        ok: { type: boolean }
      required: [ok]
      additionalProperties: false
```
