import { createHash } from "node:crypto";
import type { AgentTurnResponse, ExecutionBackendId } from "@tyrum/contracts";
import type { HarnessApprovalRouter } from "../approval-router.js";
import { createHarnessTranslator, type HarnessTranslatorSink } from "../translation.js";
import type { HarnessTurnContext } from "../types.js";
import type {
  ClaudeHookCallback,
  ClaudeHookInput,
  ClaudePermissionResult,
  ClaudeQuery,
  ClaudeQueryInput,
  ClaudeSdkMessage,
} from "./client.js";

export const CLAUDE_AGENT_SDK_BACKEND_ID: ExecutionBackendId = "claude_agent_sdk";

export interface ClaudeAgentSdkTurnPlan {
  readonly context: HarnessTurnContext;
  /** The user prompt for this turn. */
  readonly prompt: string;
  /**
   * Tyrum identity/persona, the conversation-state checkpoint, and pre-turn
   * memory recall, appended to the harness's own system prompt.
   */
  readonly systemPromptAppend: string;
  /** Prior harness session to resume, when one is still valid. */
  readonly resumeSessionRef?: string;
  /**
   * Harness-side OS sandbox. Defaults on; deployments on platforms where the
   * SDK sandbox is unavailable may turn it off without changing what is gated,
   * because every tool call reaches the approval router either way.
   */
  readonly sandboxEnabled?: boolean;
}

/** Per-turn wiring the `ExecutionBackend` port supplies for this run. */
export interface ClaudeAgentSdkRunOptions {
  /**
   * Where this turn's `chat.ui-message.stream` frames go. Overrides the
   * backend-wide sink so a streamed turn can deliver to its own subscriber.
   */
  readonly sink?: HarnessTranslatorSink;
  /** Turn deadline / cancellation from the turn runner. */
  readonly abortSignal?: AbortSignal;
}

export interface ClaudeAgentSdkBackendDeps {
  readonly query: ClaudeQuery;
  readonly approvalRouter: HarnessApprovalRouter;
  readonly sink: HarnessTranslatorSink;
  /** Records the harness session id so the next turn can resume it. */
  readonly rememberSession: (input: {
    context: HarnessTurnContext;
    sessionRef: string;
  }) => Promise<void>;
  /** Drops a session ref the harness no longer honours; see fresh-context recovery. */
  readonly forgetSession: (input: { context: HarnessTurnContext }) => Promise<void>;
  /** Writes the translated turn into Tyrum's durable transcript. */
  readonly persistTurn: (input: {
    context: HarnessTurnContext;
    prompt: string;
    parts: ReturnType<ReturnType<typeof createHarnessTranslator>["assistantParts"]>;
    reply: string;
    usedTools: readonly string[];
  }) => Promise<AgentTurnResponse>;
  readonly logger: {
    info: (m: string, f?: Record<string, unknown>) => void;
    warn: (m: string, f?: Record<string, unknown>) => void;
  };
  readonly newId: () => string;
}

/**
 * Correlates a `canUseTool` invocation with the `PreToolUse` hook that fired
 * for the same call.
 *
 * The permission callback receives only `(toolName, input)` — no tool-use id —
 * so the hook, which does get one, records the id under this fingerprint and
 * the callback claims it.
 */
function callFingerprint(toolName: string, input: unknown): string {
  return createHash("sha256")
    .update(`${toolName} ${JSON.stringify(input ?? null)}`)
    .digest("hex")
    .slice(0, 16);
}

function textFrom(message: ClaudeSdkMessage): string[] {
  const blocks = message.message?.content ?? [];
  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string);
}

/**
 * The model's own tool-use blocks, which carry the authoritative call id.
 *
 * The hooks supply the same id, but only when they fire. Reading it here too
 * means a call whose hook pairing is missed still lands in the transcript under
 * the harness's real id rather than a synthetic one.
 */
function toolUsesFrom(
  message: ClaudeSdkMessage,
): Array<{ id: string; name: string; args: unknown }> {
  const blocks = message.message?.content ?? [];
  return blocks
    .filter((block) => block.type === "tool_use" && block.id && block.name)
    .map((block) => ({
      id: block.id as string,
      name: block.name as string,
      args: block.input ?? {},
    }));
}

function stringifyToolOutput(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function toolInputOf(input: ClaudeHookInput): Record<string, unknown> {
  return (input.tool_input as Record<string, unknown> | undefined) ?? {};
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Bridges the turn runner's `AbortSignal` onto the controller the SDK accepts.
 *
 * Without it a cancelled or timed-out turn leaves the harness running: it would
 * keep executing tools, and would then rewrite the conversation transcript
 * after the turn had already been marked failed.
 */
function linkAbortSignal(signal: AbortSignal | undefined): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  if (!signal) return { controller, dispose: () => undefined };
  if (signal.aborted) {
    controller.abort(signal.reason);
    return { controller, dispose: () => undefined };
  }
  const onAbort = (): void => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  return { controller, dispose: () => signal.removeEventListener("abort", onAbort) };
}

/** The two taps a turn installs into the SDK, plus the state they share. */
interface TurnTaps {
  readonly observe: ClaudeHookCallback;
  readonly canUseTool: (
    toolName: string,
    input: Record<string, unknown>,
    options: { signal?: AbortSignal },
  ) => Promise<ClaudePermissionResult>;
  /** Records authoritative tool-use ids seen on the SDK message stream. */
  readonly noteToolUse: (input: { id: string; name: string; args: unknown }) => void;
  /** Latest harness session id seen for this turn. */
  sessionRef: string | undefined;
  /** True once the harness reported a session, i.e. the turn really started. */
  sessionStarted: boolean;
}

function createTurnTaps(input: {
  deps: ClaudeAgentSdkBackendDeps;
  plan: ClaudeAgentSdkTurnPlan;
  translator: ReturnType<typeof createHarnessTranslator>;
}): TurnTaps {
  const { deps, plan, translator } = input;
  /**
   * Tool-use ids seen by the observation tap that the ask tap has not claimed
   * yet, queued FIFO per call fingerprint.
   *
   * A queue rather than a single id because a model may issue the *same* call
   * more than once in a turn. Collapsing those onto one id would let the second
   * execution ride the first one's approval — an operator who approved one
   * `rm -rf build` has not approved two — and would drop the repeat from the
   * transcript, understating what actually ran.
   */
  const unclaimedCallIds = new Map<string, string[]>();
  const recordedCallIds = new Set<string>();
  /** Asks seen per fingerprint this turn; the approval's identity, see below. */
  const askCounts = new Map<string, number>();

  const enqueueCallId = (toolName: string, args: unknown, callId: string): void => {
    const fingerprint = callFingerprint(toolName, args);
    const queue = unclaimedCallIds.get(fingerprint);
    if (queue) queue.push(callId);
    else unclaimedCallIds.set(fingerprint, [callId]);
  };

  const dropQueue = (fingerprint: string, queue: string[]): void => {
    if (queue.length === 0) unclaimedCallIds.delete(fingerprint);
  };

  /**
   * Retires a call id once its execution reached a terminal state.
   *
   * A `PreToolUse` callback that exceeds its timeout blocks the call, so
   * `canUseTool` never runs for it. Without this, that id would sit at the head
   * of the queue for the rest of the turn and every later identical call would
   * claim its predecessor's id — binding each approval to the wrong execution.
   */
  const releaseCallId = (toolName: string, args: unknown, callId: string): void => {
    const fingerprint = callFingerprint(toolName, args);
    const queue = unclaimedCallIds.get(fingerprint);
    if (!queue) return;
    const index = queue.indexOf(callId);
    if (index !== -1) queue.splice(index, 1);
    dropQueue(fingerprint, queue);
  };

  /**
   * Distinguishes this attempt from any other run of the same turn.
   *
   * The approval key is scoped by `turnId`, which is stable across retries, so a
   * purely deterministic ask id would rebuild a previous attempt's key exactly.
   * `ApprovalDal.create` does nothing on conflict and returns the existing row —
   * an already-approved one — letting a retry execute without ever asking.
   *
   * Re-asking is the fail-safe choice here: the harness blocks in-process while
   * an approval resolves rather than pausing and restarting the turn, so nothing
   * legitimately needs to inherit a previous attempt's decision.
   */
  const attemptId = deps.newId();

  /**
   * The identity of one ask, independent of any execution id.
   *
   * The SDK hands `canUseTool` no tool-use id, so pairing an ask to an execution
   * is always inference. Deriving the *approval's* identity from that inference
   * would make a durable security record only as reliable as a heuristic. The
   * counter is monotonic within an attempt and the attempt id separates
   * attempts, so no two asks can ever collide on an approval key.
   */
  const nextAskId = (fingerprint: string): string => {
    const seq = (askCounts.get(fingerprint) ?? 0) + 1;
    askCounts.set(fingerprint, seq);
    return `${attemptId}-${fingerprint}-ask-${seq}`;
  };

  /**
   * Best-effort pairing of an ask to the execution it most likely belongs to,
   * used only to attach the decision to a transcript part. Identical calls are
   * interchangeable for policy, so FIFO order is enough.
   */
  const claimCallId = (toolName: string, args: unknown): string | undefined => {
    const fingerprint = callFingerprint(toolName, args);
    const queue = unclaimedCallIds.get(fingerprint);
    const claimed = queue?.shift();
    if (queue) dropQueue(fingerprint, queue);
    return claimed;
  };

  /** Idempotent: whichever tap sees the call first puts it in the transcript. */
  const recordCall = async (
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<void> => {
    if (recordedCallIds.has(callId)) return;
    recordedCallIds.add(callId);
    await translator.handle({ kind: "tool_call", call: { callId, toolName, input: args } });
  };

  const taps: TurnTaps = {
    sessionRef: plan.resumeSessionRef,
    sessionStarted: false,

    noteToolUse: ({ id, name, args }) => {
      const fingerprint = callFingerprint(name, args);
      // Whichever tap sees the call first supplies the id; never enqueue twice.
      if (unclaimedCallIds.get(fingerprint)?.includes(id) === true) return;
      if (recordedCallIds.has(id)) return;
      enqueueCallId(name, args, id);
    },

    observe: async (hookInput, toolUseId) => {
      const toolName = hookInput.tool_name;
      if (!toolName) return {};
      // The harness's own tool-use id is unique per call, so it is authoritative
      // whenever present — never substitute an earlier call's id for it.
      const callId = toolUseId ?? deps.newId();

      if (hookInput.hook_event_name === "PreToolUse") {
        enqueueCallId(toolName, hookInput.tool_input, callId);
        await recordCall(callId, toolName, toolInputOf(hookInput));
        return {};
      }

      if (hookInput.hook_event_name === "PostToolUse") {
        // Terminal: retire the id so a later identical call cannot claim it.
        releaseCallId(toolName, hookInput.tool_input, callId);
        await translator.handle({
          kind: "tool_result",
          callId,
          toolName,
          ok: true,
          content: stringifyToolOutput(hookInput.tool_response),
        });
        return {};
      }

      if (hookInput.hook_event_name === "PostToolUseFailure") {
        releaseCallId(toolName, hookInput.tool_input, callId);
        // Without this the transcript would keep a failed call at
        // `input-available` for ever, with neither an output nor a cause.
        await translator.handle({
          kind: "tool_result",
          callId,
          toolName,
          ok: false,
          content:
            hookInput.is_interrupt === true
              ? `tool call was interrupted: ${hookInput.error ?? ""}`.trim()
              : (hookInput.error ?? "tool execution failed"),
        });
      }
      return {};
    },

    canUseTool: async (toolName, args, options) => {
      // The approval's identity is minted here and owes nothing to the pairing
      // below, so an ask can never inherit another ask's approval.
      const askId = nextAskId(callFingerprint(toolName, args));
      // A permission callback with no `PreToolUse` pairing would otherwise leave
      // the call — and the operator's decision on it — with no transcript part
      // to attach to.
      const callId = claimCallId(toolName, args) ?? askId;
      await recordCall(callId, toolName, args);

      const decision = await deps.approvalRouter.evaluate({
        call: { callId: askId, toolName, input: args },
        context: plan.context,
        sessionRef: taps.sessionRef,
        abortSignal: options?.signal,
        onApprovalPending: async ({ approvalId }) => {
          await translator.notePendingApproval({ callId, approvalId });
        },
      });

      await translator.handle({ kind: "approval_resolved", callId, toolName, decision });

      if (decision.kind === "allow") {
        // `updatedInput` is required on allow; pass the request through
        // unchanged so the adapter never rewrites what policy evaluated.
        return { behavior: "allow", updatedInput: args };
      }
      // The message reaches the model, which is how an operator denial becomes
      // something the agent visibly reacts to.
      return { behavior: "deny", message: decision.reason };
    },
  };

  return taps;
}

function buildQueryInput(input: {
  plan: ClaudeAgentSdkTurnPlan;
  taps: TurnTaps;
  resumeSessionRef: string | undefined;
  abortController: AbortController;
}): ClaudeQueryInput {
  return {
    prompt: input.plan.prompt,
    options: {
      // Confines the harness to the conversation's workspace.
      cwd: input.plan.context.workspaceRoot,
      resume: input.resumeSessionRef,
      canUseTool: input.taps.canUseTool,
      abortController: input.abortController,
      hooks: {
        PreToolUse: [{ hooks: [input.taps.observe] }],
        PostToolUse: [{ hooks: [input.taps.observe] }],
        PostToolUseFailure: [{ hooks: [input.taps.observe] }],
      },
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: input.plan.systemPromptAppend,
      },
      permissionMode: "default",
      // Tyrum policy is the only source of capability posture. Loading the
      // workspace's own .claude/settings.json would let a repository grant
      // itself allow rules that bypass the approval router.
      settingSources: [],
      // Defense in depth only. `autoAllowBashIfSandboxed` stays off so a
      // sandboxed shell still passes through the approval router, and
      // `allowUnsandboxedCommands` stays off because it defaults to true: the
      // model could otherwise set `dangerouslyDisableSandbox` on a Bash call,
      // which is not part of the match target an operator approved.
      sandbox: {
        enabled: input.plan.sandboxEnabled ?? true,
        autoAllowBashIfSandboxed: false,
        allowUnsandboxedCommands: false,
      },
    },
  };
}

/**
 * The Claude Agent SDK execution backend.
 *
 * Two taps, kept separate on purpose:
 *  - `canUseTool` is the ask channel. Every tool call reaches it, and a denial
 *    carries a message the model sees and reacts to.
 *  - `PreToolUse`/`PostToolUse`/`PostToolUseFailure` hooks are the observation
 *    channel. They carry the tool-use id and the result, which the permission
 *    callback never sees, and they are what puts a call into the transcript.
 */
export function createClaudeAgentSdkBackend(deps: ClaudeAgentSdkBackendDeps) {
  return {
    id: CLAUDE_AGENT_SDK_BACKEND_ID,

    async runTurn(
      plan: ClaudeAgentSdkTurnPlan,
      options?: ClaudeAgentSdkRunOptions,
    ): Promise<AgentTurnResponse> {
      const translator = createHarnessTranslator({
        sink: options?.sink ?? deps.sink,
        newId: deps.newId,
      });
      const taps = createTurnTaps({ deps, plan, translator });
      const abort = linkAbortSignal(options?.abortSignal);

      const runSession = async (resumeSessionRef: string | undefined): Promise<void> => {
        const iterator = deps.query(
          buildQueryInput({ plan, taps, resumeSessionRef, abortController: abort.controller }),
        );

        for await (const message of iterator) {
          if (message.type === "system" && message.subtype === "init" && message.session_id) {
            taps.sessionRef = message.session_id;
            taps.sessionStarted = true;
            await deps.rememberSession({ context: plan.context, sessionRef: taps.sessionRef });
            await translator.handle({
              kind: "session_started",
              sessionRef: taps.sessionRef,
              resumed: resumeSessionRef === taps.sessionRef,
            });
            continue;
          }

          if (message.type === "assistant") {
            for (const toolUse of toolUsesFrom(message)) {
              taps.noteToolUse(toolUse);
            }
            for (const text of textFrom(message)) {
              await translator.handle({ kind: "assistant_text", text });
            }
            continue;
          }

          if (message.type === "result") {
            await translator.handle({
              kind: "turn_completed",
              reply: message.result ?? translator.replyText(),
              usedTools: translator.usedTools(),
            });
          }
        }
      };

      const persist = async (): Promise<AgentTurnResponse> =>
        await deps.persistTurn({
          context: plan.context,
          prompt: plan.prompt,
          parts: translator.assistantParts(),
          reply: translator.replyText(),
          usedTools: translator.usedTools(),
        });

      try {
        try {
          await runSession(plan.resumeSessionRef);
        } catch (err) {
          // Session refs are a cache, not truth (ARCH-22). A harness that no
          // longer honours the ref must not fail the turn: drop the row and
          // start fresh, seeded from Tyrum's conversation-state checkpoint,
          // which `systemPromptAppend` already carries. Only safe while the
          // session never started — otherwise a retry would re-run tool calls
          // that already had side effects.
          if (plan.resumeSessionRef === undefined || taps.sessionStarted) throw err;
          deps.logger.warn("harness.session.resume_rejected", {
            backend_id: CLAUDE_AGENT_SDK_BACKEND_ID,
            conversation_id: plan.context.conversationId,
            session_ref: plan.resumeSessionRef,
            error: errorMessage(err),
          });
          await deps.forgetSession({ context: plan.context });
          taps.sessionRef = undefined;
          await runSession(undefined);
        }
      } catch (err) {
        // Everything the turn produced before it failed is already evidence: an
        // approved shell command may have run. Persisting it is what keeps the
        // approval rows pointing at a transcript that still shows the call.
        await translator.handle({ kind: "error", message: errorMessage(err) });
        try {
          await persist();
        } catch (persistErr) {
          deps.logger.warn("harness.turn.partial_persist_failed", {
            backend_id: CLAUDE_AGENT_SDK_BACKEND_ID,
            conversation_id: plan.context.conversationId,
            turn_id: plan.context.turnId,
            error: errorMessage(persistErr),
          });
        }
        throw err;
      } finally {
        abort.dispose();
      }

      deps.logger.info("harness.turn.completed", {
        backend_id: CLAUDE_AGENT_SDK_BACKEND_ID,
        conversation_id: plan.context.conversationId,
        turn_id: plan.context.turnId,
        session_ref: taps.sessionRef,
        used_tools: translator.usedTools().length,
      });

      return await persist();
    },
  };
}
