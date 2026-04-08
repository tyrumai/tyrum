# Live Agent Benchmarks

Tyrum now supports a YAML-authored live benchmark format for scoring real agent runs with real LLMs.

The v1 implementation is CLI-driven:

- `tyrum-cli benchmark validate --suite <path>`
- `tyrum-cli benchmark run --suite <path> --judge-model <provider/model> [--model <provider/model>] [--scenario <id>] [--repeat <n>] [--agent-key <key>] [--output <dir>]`

## What v1 does

- Loads and validates a benchmark suite from YAML with typed `@tyrum/contracts` schemas.
- Clones the target agent into an isolated temporary benchmark agent for each scenario run.
- Seeds prior conversations and secret refs on the temporary agent so benchmark runs do not pollute the source agent.
- Runs the scored prompt over the normal conversation WebSocket path.
- Captures trace data from existing gateway events:
  - `chat.ui-message.stream`
  - `tool.lifecycle`
  - `context_report.created`
  - `approval.updated`
  - `transcript.get`
- Normalizes deterministic metrics such as failed tool calls, browser usage, sandbox usage, approvals, secret tool calls, memory hits, and missing or forbidden tool families.
- Sends a structured judge packet to a separate temporary judge agent and maps the judge verdict to `passed`, `failed`, `inconclusive`, or `infrastructure_error`.

## Sandbox browser expectation

Browser-heavy benchmarks should require the agent to request a managed sandbox rather than talking directly to a mocked browser tool.

Use these scenario flags:

- `environment.sandbox_request_required: true`
- `environment.browser_required: true`
- `environment.required_tool_families` including:
  - `sandbox.`
  - `tool.browser.`

When `sandbox_request_required` is set, the runner performs a preflight check against `desktopEnvironmentHosts.list` and fails the scenario as `infrastructure_error` if no healthy desktop environment host is available.

This means the benchmark expects the agent to:

1. call `sandbox.request`
2. wait for the sandbox-backed node attachment
3. use browser tools through that sandbox-attached node

## Current built-in artifacts

The v1 runner collects these built-in artifacts:

- `final_reply`
- `transcript`
- `conversation`
- `stream_events`
- `tool_events`
- `context_reports`
- `approval_events`

If a scenario requires an artifact outside that built-in set, the runner records it as missing and passes that fact to the judge.

## Scenario shape

See [`examples/core-live-v1.yaml`](./examples/core-live-v1.yaml) for a concrete suite.

Important fields:

- `defaults.agent_key`: source agent to clone unless overridden
- `seed.conversations[]`: prior conversations that should become memory
- `seed.secret_refs[]`: secret refs injected into the temporary benchmark agent config
- `environment.required_tool_families[]`: capability families that must appear in the trace
- `environment.disallowed_tool_families[]`: capability families that must not appear
- `environment.approval_mode`: `none` or `must_request_autoapprove`
- `trace.checks[]`: judge-visible checks such as `browser_used`, `sandbox_requested`, `no_unnecessary_questions`, `checkout_completed`

## Judge policy

The runner treats the judge as the source of truth for `pass`, `fail`, and `inconclusive`.

The judge instructions explicitly say:

- tool-call ordering does not matter
- extra harmless tool use is a penalty, not an automatic failure
- unnecessary questions, unjustified refusal, wrong tool families, missing sandbox request, secret mishandling, and ungrounded success claims matter more than efficiency
- claimed completion without evidence is a failure

## Notes

- `--judge-model` is required.
- `--model` is optional and overrides the cloned benchmark agent model for the run.
- The runner uses temporary agents and deletes them after the run on a best-effort basis.
- Secret refs referenced by a suite must already exist in the gateway secret store.
- For browser benchmarks, the deployment must already have a healthy managed desktop host available.
