# Harness adapters

Shared machinery behind the `ExecutionBackend` port (ARCH-22). Every external
harness — Claude Agent SDK, Codex app-server, OpenCode — reuses the layers here
and contributes only its own event translation and tool table.

## Layers

| Module                     | Responsibility                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `types.ts`                 | The normalized `HarnessEvent` vocabulary every adapter emits                       |
| `tool-mapping.ts`          | Resolves a harness tool call onto Tyrum's tool taxonomy and policy match target    |
| `workspace-confinement.ts` | The `assertSandboxed` invariant, applied to harness path arguments                 |
| `role-ceiling.ts`          | The execution-profile and state-mode ceiling the native tool set builder applies   |
| `approval-router.ts`       | The shared ask channel: policy evaluation, durable approval, block until resolved  |
| `translation.ts`           | The shared observation channel: transcript parts + `chat.ui-message.stream` frames |
| `ui-message-stream.ts`     | Bridges that sink onto the `ExecutionBackend` streaming port                       |
| `session-dal.ts`           | `(conversation, backend) -> harness session ref`, a resume-fidelity cache only     |

## Two taps, not one

Adapters maintain two separate taps per backend, and they must not be conflated:

- **Ask channel** (gating) — the harness's permission callback routes into
  `approval-router.ts`. Every tool call reaches it; it decides allow or deny and
  blocks on a durable approval when policy says `require_approval`.
- **Observation channel** (evidence) — every tool call and _result_ flows
  through `translation.ts` into the durable transcript.

The permission callback sees only `(toolName, input)`: no tool-use id, no
result, and nothing at all for a call the harness resolved without asking. The
observation tap is therefore the only thing that can record what actually ran
and what it produced — without it, a call Tyrum allowed without an approval
would leave no transcript record and conformance criterion 6 would fail.

## The mapping table is data, never policy

A backend's tool table (`HarnessToolMap`) states _what a call is_ — its Tyrum
tool id, its effect, and how to rewrite the harness's argument names into the
shape `canonicalizeToolMatchTarget` expects. It never states whether a call is
allowed. Capability posture (allow / require_approval / deny) is policy
configuration, per ARCH-22's non-negotiable rules.

`mapHarnessToolCall` fails closed. A tool with no table entry — including every
MCP tool, whose semantics Tyrum cannot know statically — is reported as
`state_changing`, so the policy engine's implicit decision sends it to the ask
channel rather than silently allowing it.

## No harness-native allow list

Harness sandboxes and permission rules are defense in depth, not the control.
A backend must not name anything in a harness-native allow list.

In the Claude Agent SDK the permission order is hooks → deny → ask → mode →
allow → `canUseTool`, and **a tool matched by an allow rule never reaches
`canUseTool`**. The permission callback is the only place Tyrum sees a call's
_arguments_, so an allow entry — which matches on tool _identity_ — withdraws
both policy evaluation and workspace confinement for every future invocation of
that tool. A bare `"Read"` auto-approves a read of `~/.ssh/id_rsa` just as
readily as one of `README.md`, and the native path refuses the first outright.

Proving that no policy pattern could gate a tool is therefore not sufficient: no
property of a tool name bounds the arguments it will be called with. Everything
goes through the permission callback, and the cost is one in-process policy
evaluation per call — exactly what the native path pays.

A bounded projection (an allow rule carrying an argument specifier, e.g. the
SDK's `PermissionRuleValue.ruleContent`) could restore a fast path, but the
installed SDK documents `allowedTools` only as a "List of tool names". Treat
that as unverified until the vendor confirms the specifier syntax for the exact
deployed version.

## Two invariants policy cannot express

The ask channel enforces two things before it evaluates policy, because the
native path enforces them somewhere a harness turn never reaches:

- **Workspace confinement.** `ToolExecutor.assertSandboxed` throws
  `path escapes workspace: <path>` before any native filesystem tool runs, and it
  does so regardless of policy mode. A harness runs its own tools, so
  `workspace-confinement.ts` applies the identical check to the raw path
  argument a backend's tool table declares via `pathArg`. This cannot live in
  policy: `canonicalizeToolMatchTarget` collapses an escaping path to the empty
  string, so `read:` cannot distinguish "outside the workspace" from "no path".
  For the same reason a collapsed match target never yields a suggested
  override.
- **The role ceiling.** `isRoleAllowedForTool` combines the execution profile's
  allow/deny lists with the gateway state mode, which withdraws the filesystem
  and shell builtins outside `local`. `roleAllowed === false` is the policy
  engine's only unconditional deny — no approval and no override can lift it —
  and natively the tool is absent from the turn's tool surface entirely, so
  observe-only mode does not restore it either.

## Claude Agent SDK adapter

`claude-agent-sdk/` is the first adapter. Four choices in it are load-bearing:

- **`settingSources: []`** — the SDK otherwise loads `.claude/settings.json` from
  the working directory, which would let a repository grant itself allow rules
  that bypass the approval router. Tyrum policy is the only source of posture.
- **`sandbox.autoAllowBashIfSandboxed: false`** — leaving this on auto-approves
  Bash whenever the sandbox is active, and auto-approved tools never reach
  `canUseTool`. The sandbox is defense in depth; the router is the control.
- **`sandbox.allowUnsandboxedCommands: false`** — this one defaults to **true**,
  and `dangerouslyDisableSandbox` is a model-settable `Bash` input. Tyrum's
  match target is the command string alone, so the sandboxed and unsandboxed
  variants of one command are indistinguishable to an operator approving it, and
  to any override minted from that approval.
- **No `allowedTools`** — see above.
- **The SDK is imported lazily** (`loadClaudeQuery`) so neither it nor the
  platform binary it bundles is loaded while the backend flag is off.

`canUseTool` receives `(toolName, input)` with no tool-use id, so a call id is
minted once per call fingerprint and both taps claim it: whichever fires first
puts the call into the transcript, and the other reuses the same id. A call that
reaches only the permission callback is still recorded, so an operator's
decision always has a part to attach to.

A denial returns `{ behavior: "deny", message }`; the message is what the model
sees, which is how an operator denial becomes something the agent reacts to.

`PostToolUseFailure` is subscribed alongside `PostToolUse`: without it a failed
or interrupted call would stay at `input-available` in the transcript for ever,
with neither an output nor a cause.

A turn that throws part-way still persists what it produced before rethrowing.
An approved shell command may already have run, and the approval row must not be
left pointing at a transcript that never shows the call.

## Lossy events

The normalized `HarnessEvent` union is deliberately narrower than any single
harness's native stream. These are dropped in translation and are not recoverable
from the Tyrum transcript:

| Dropped                            | Why                                                                   |
| ---------------------------------- | --------------------------------------------------------------------- |
| Model thinking / reasoning blocks  | Not part of the durable transcript contract; may be redacted upstream |
| Token-level usage per tool call    | Aggregated at turn level, not per call                                |
| Harness-internal retries           | Only the resolved outcome is durable                                  |
| Partial (streaming) tool input     | Tool parts are recorded at `input-available`, not per input delta     |
| Harness-side compaction boundaries | Tyrum owns its own conversation-state checkpoint                      |
| Subagent nesting structure         | Subagent calls are flattened into the parent turn's transcript        |

Text and tool activity are lossless: every assistant text delta and every tool
call, result, and approval outcome reaches both the stream and the transcript.

## Session refs are a cache, not truth

`harness_sessions` maps a conversation to the harness's own session id so a
second message continues the same harness context. Per ARCH-22 it is a
resume-fidelity cache only, and both directions of loss are handled:

- **Row gone** — the next turn simply starts a fresh session.
- **Row present, harness-side continuity gone** — the harness rejects the
  `resume` ref and the session fails to start. The adapter drops the row and
  retries once without it, seeded from the conversation-state checkpoint the
  system-prompt append already carries. The retry is allowed only while the
  session never started; once it has, a retry could re-run tool calls that
  already had side effects, so the failure propagates instead.

Conversation history stays fully readable from Tyrum either way.
