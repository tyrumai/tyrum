import { describe, expect, it } from "vitest";
import {
  createClaudeAgentSdkBackend,
  type ClaudeAgentSdkTurnPlan,
} from "../../src/modules/harness/claude-agent-sdk/backend.js";
import type {
  ClaudeQueryInput,
  ClaudeSdkMessage,
} from "../../src/modules/harness/claude-agent-sdk/client.js";
import type { UiMessageChunk } from "../../src/modules/harness/translation.js";
import type {
  HarnessApprovalDecision,
  HarnessTurnContext,
} from "../../src/modules/harness/types.js";

const CONTEXT: HarnessTurnContext = {
  backendId: "claude_agent_sdk",
  tenantId: "tenant-1",
  agentId: "agent-1",
  workspaceId: "workspace-1",
  conversationId: "conv-1",
  conversationKey: "conv-key-1",
  channel: "web",
  threadId: "thread-1",
  turnId: "turn-1",
  workspaceRoot: "/workspace",
};

const PLAN: ClaudeAgentSdkTurnPlan = {
  context: CONTEXT,
  prompt: "list the files",
  systemPromptAppend: "You are Tyrum.",
};

/**
 * Drives the adapter with a scripted SDK conversation, exercising the real
 * permission callback and hooks the adapter installs.
 */
function harness(input: {
  decision?: HarnessApprovalDecision;
  /** Fails the persist call, so a secondary failure cannot mask the first. */
  persistFails?: boolean;
  /** The harness rejects the resume ref, as it does once continuity is gone. */
  failWhenResuming?: boolean;
  script?: (io: {
    canUseTool: ClaudeQueryInput["options"]["canUseTool"];
    hooks: ClaudeQueryInput["options"]["hooks"];
  }) => Promise<ClaudeSdkMessage[]>;
}) {
  const chunks: UiMessageChunk[] = [];
  const persisted: Array<Record<string, unknown>> = [];
  const sessions: string[] = [];
  const evaluated: Array<{ toolName: string; callId: string }> = [];
  const warnings: string[] = [];
  const forgotten: boolean[] = [];
  const resumes: Array<string | undefined> = [];
  let capturedOptions: ClaudeQueryInput["options"] | undefined;
  let seq = 0;

  const backend = createClaudeAgentSdkBackend({
    query: (queryInput) => {
      capturedOptions = queryInput.options;
      resumes.push(queryInput.options.resume);
      const runner = input.script ?? (async () => []);
      const rejectResume =
        input.failWhenResuming === true && queryInput.options.resume !== undefined;
      return {
        async *[Symbol.asyncIterator]() {
          if (rejectResume) {
            throw new Error(`no conversation found with session ID: ${queryInput.options.resume}`);
          }
          yield { type: "system", subtype: "init", session_id: "sdk-session-1" };
          for (const message of await runner({
            canUseTool: queryInput.options.canUseTool,
            hooks: queryInput.options.hooks,
          })) {
            yield message;
          }
          yield { type: "result", result: "done" };
        },
      };
    },
    approvalRouter: {
      evaluate: async ({ call }) => {
        evaluated.push({ toolName: call.toolName, callId: call.callId });
        return input.decision ?? { kind: "allow" };
      },
    },
    sink: { emitChunk: (chunk) => void chunks.push(chunk) },
    rememberSession: async ({ sessionRef }) => void sessions.push(sessionRef),
    forgetSession: async () => void forgotten.push(true),
    persistTurn: async (turn) => {
      persisted.push({ ...turn });
      if (input.persistFails) throw new Error("transcript write failed");
      return {
        reply: turn.reply,
        conversation_id: "00000000-0000-4000-8000-000000000000",
        conversation_key: CONTEXT.conversationKey,
        attachments: [],
        used_tools: [...turn.usedTools],
        memory_written: false,
      };
    },
    logger: { info: () => {}, warn: (message) => void warnings.push(message) },
    newId: () => `id-${++seq}`,
  });

  return {
    backend,
    chunks,
    persisted,
    sessions,
    evaluated,
    warnings,
    forgotten,
    resumes,
    options: () => capturedOptions,
  };
}

function preToolUse(toolName: string, toolInput: Record<string, unknown>) {
  return { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput };
}

describe("createClaudeAgentSdkBackend", () => {
  it("confines the harness and refuses to inherit workspace-side settings", async () => {
    const h = harness({});
    await h.backend.runTurn(PLAN);
    const options = h.options();

    expect(options?.cwd).toBe("/workspace");
    expect(options?.permissionMode).toBe("default");
    // A repo's own .claude/settings.json must not be able to grant allow rules.
    expect(options?.settingSources).toEqual([]);
    expect(options?.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "You are Tyrum.",
    });
  });

  it("pre-authorizes no tool, so every call reaches the approval router", async () => {
    const h = harness({});
    await h.backend.runTurn(PLAN);
    // A tool named in `allowedTools` never reaches `canUseTool`, which is the
    // only place Tyrum sees the arguments. Nothing may be listed there.
    expect(h.options()).not.toHaveProperty("allowedTools");
  });

  it("sandboxes without letting the sandbox auto-approve or be disabled by the model", async () => {
    const h = harness({});
    await h.backend.runTurn(PLAN);
    // autoAllowBashIfSandboxed would approve Bash before canUseTool is reached.
    // allowUnsandboxedCommands defaults to true in the SDK and would let the
    // model pass `dangerouslyDisableSandbox` on a Bash call Tyrum approved as
    // sandboxed.
    expect(h.options()?.sandbox).toEqual({
      enabled: true,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
    });
  });

  it("allows a deployment to disable the sandbox without changing what is gated", async () => {
    const h = harness({});
    await h.backend.runTurn({ ...PLAN, sandboxEnabled: false });
    expect(h.options()?.sandbox).toEqual({
      enabled: false,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
    });
  });

  it("records the harness session so the next turn can resume it", async () => {
    const h = harness({});
    await h.backend.runTurn(PLAN);
    expect(h.sessions).toEqual(["sdk-session-1"]);
  });

  it("passes the resume ref through to the SDK", async () => {
    const h = harness({});
    await h.backend.runTurn({ ...PLAN, resumeSessionRef: "prior-session" });
    expect(h.options()?.resume).toBe("prior-session");
  });

  it("streams assistant text and persists the reply", async () => {
    const h = harness({
      script: async () => [
        { type: "assistant", message: { content: [{ type: "text", text: "hello" }] } },
      ],
    });
    const response = await h.backend.runTurn(PLAN);

    expect(response.reply).toBe("hello");
    expect(h.chunks.map((c) => c.type)).toEqual(["text-start", "text-delta", "text-end", "finish"]);
    expect(h.persisted[0]?.["parts"]).toEqual([{ type: "text", text: "hello", state: "done" }]);
  });

  it("observes a call through the hooks alone, without an ask-channel round trip", async () => {
    const h = harness({
      script: async ({ hooks }) => {
        const observe = hooks["PreToolUse"]?.[0]?.hooks[0];
        const post = hooks["PostToolUse"]?.[0]?.hooks[0];
        // Only the hooks fire: the observation tap, not `canUseTool`, is what
        // puts a call and its result into the transcript.
        await observe?.(preToolUse("Read", { file_path: "a.ts" }), "toolu_1", {});
        await post?.(
          {
            hook_event_name: "PostToolUse",
            tool_name: "Read",
            tool_response: "file body",
          },
          "toolu_1",
          {},
        );
        return [];
      },
    });
    await h.backend.runTurn(PLAN);

    // The ask channel was never consulted...
    expect(h.evaluated).toEqual([]);
    // ...but the call still reached the durable transcript.
    expect(h.persisted[0]?.["parts"]).toEqual([
      {
        type: "tool-Read",
        toolCallId: "toolu_1",
        state: "output-available",
        input: { file_path: "a.ts" },
        output: "file body",
      },
    ]);
    expect(h.persisted[0]?.["usedTools"]).toEqual(["Read"]);
  });

  it("routes a gated call through the approval router and allows it", async () => {
    const h = harness({
      decision: { kind: "allow", approvalId: "approval-1" },
      script: async ({ canUseTool, hooks }) => {
        const observe = hooks["PreToolUse"]?.[0]?.hooks[0];
        await observe?.(preToolUse("Bash", { command: "ls" }), "toolu_9", {});
        const result = await canUseTool("Bash", { command: "ls" }, {});
        expect(result).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
        return [];
      },
    });
    await h.backend.runTurn(PLAN);

    expect(h.evaluated).toHaveLength(1);
    expect(h.evaluated[0]?.toolName).toBe("Bash");
    // The transcript still carries the harness's own tool-use id...
    const parts = h.persisted[0]?.["parts"] as Array<Record<string, unknown>>;
    expect(parts[0]?.["toolCallId"]).toBe("toolu_9");
    // ...while the approval is identified independently of it, so a durable
    // security record never rests on the ask-to-execution pairing heuristic.
    expect(h.evaluated[0]?.callId).not.toBe("toolu_9");
  });

  it("propagates an operator denial to the model as a message", async () => {
    const h = harness({
      decision: { kind: "deny", reason: "too destructive", approvalId: "approval-1" },
      script: async ({ canUseTool, hooks }) => {
        const observe = hooks["PreToolUse"]?.[0]?.hooks[0];
        await observe?.(preToolUse("Bash", { command: "rm -rf /" }), "toolu_2", {});
        const result = await canUseTool("Bash", { command: "rm -rf /" }, {});
        // This message is what Claude sees and reacts to.
        expect(result).toEqual({ behavior: "deny", message: "too destructive" });
        return [];
      },
    });
    await h.backend.runTurn(PLAN);

    expect(h.chunks.map((c) => c.type)).toEqual([
      "tool-input-available",
      "tool-output-denied",
      "finish",
    ]);
    expect(h.persisted[0]?.["parts"]).toMatchObject([
      { state: "output-denied", errorText: "too destructive" },
    ]);
  });
});

describe("createClaudeAgentSdkBackend evidence and failure handling", () => {
  it("still records a call and its refusal when the hook pairing is missed", async () => {
    const h = harness({
      decision: { kind: "deny", reason: "operator denied this tool call" },
      script: async ({ canUseTool }) => {
        // canUseTool without a preceding PreToolUse pairing.
        await canUseTool("Bash", { command: "ls" }, {});
        return [];
      },
    });
    await h.backend.runTurn(PLAN);

    expect(h.evaluated).toHaveLength(1);
    expect(h.evaluated[0]?.toolName).toBe("Bash");
    // The gated call and the operator's denial must be durable, not just a
    // stream chunk pointing at a transcript part that was never created.
    expect(h.persisted[0]?.["parts"]).toMatchObject([
      {
        type: "tool-Bash",
        input: { command: "ls" },
        state: "output-denied",
        errorText: "operator denied this tool call",
      },
    ]);
    expect(h.persisted[0]?.["usedTools"]).toEqual(["Bash"]);
  });

  it("does not record the call twice when the hook arrives as well", async () => {
    const h = harness({
      script: async ({ canUseTool, hooks }) => {
        const observe = hooks["PreToolUse"]?.[0]?.hooks[0];
        await observe?.(preToolUse("Bash", { command: "ls" }), "toolu_7", {});
        await canUseTool("Bash", { command: "ls" }, {});
        return [];
      },
    });
    await h.backend.runTurn(PLAN);
    expect(h.persisted[0]?.["parts"]).toHaveLength(1);
  });

  it("records a failed tool call rather than leaving it unresolved", async () => {
    const h = harness({
      script: async ({ hooks }) => {
        const observe = hooks["PreToolUse"]?.[0]?.hooks[0];
        const failed = hooks["PostToolUseFailure"]?.[0]?.hooks[0];
        expect(failed).toBeDefined();
        await observe?.(preToolUse("Bash", { command: "npm test" }), "toolu_3", {});
        await failed?.(
          {
            hook_event_name: "PostToolUseFailure",
            tool_name: "Bash",
            tool_input: { command: "npm test" },
            error: "exit code 1",
          },
          "toolu_3",
          {},
        );
        return [];
      },
    });
    await h.backend.runTurn(PLAN);

    // A failure recorded as `output-available` would durably show a failed
    // command as a successful one.
    expect(h.persisted[0]?.["parts"]).toMatchObject([
      { state: "output-error", errorText: "exit code 1" },
    ]);
    expect(h.chunks.map((c) => c.type)).toContain("tool-output-error");
  });

  it("persists the evidence of a turn that fails part-way and rethrows", async () => {
    const h = harness({
      script: async ({ hooks }) => {
        const observe = hooks["PreToolUse"]?.[0]?.hooks[0];
        const post = hooks["PostToolUse"]?.[0]?.hooks[0];
        await observe?.(preToolUse("Bash", { command: "rm -rf build" }), "toolu_4", {});
        await post?.(
          {
            hook_event_name: "PostToolUse",
            tool_name: "Bash",
            tool_input: { command: "rm -rf build" },
            tool_response: "removed",
          },
          "toolu_4",
          {},
        );
        throw new Error("429 rate limited");
      },
    });

    await expect(h.backend.runTurn(PLAN)).rejects.toThrow("429 rate limited");

    // The destructive command already ran; its record must not be discarded.
    expect(h.persisted).toHaveLength(1);
    expect(h.persisted[0]?.["parts"]).toMatchObject([
      { type: "tool-Bash", state: "output-available", output: "removed" },
      { type: "harness-error", errorText: "429 rate limited" },
    ]);
  });

  it("reports the original failure when the salvage write also fails", async () => {
    const h = harness({
      persistFails: true,
      script: async () => {
        throw new Error("socket reset");
      },
    });

    await expect(h.backend.runTurn(PLAN)).rejects.toThrow("socket reset");
    expect(h.warnings).toContain("harness.turn.partial_persist_failed");
  });

  it("hands the turn deadline to the harness as an abort controller", async () => {
    const runnerAbort = new AbortController();
    const observedWhileRunning: Array<boolean | undefined> = [];
    const h = harness({
      script: async () => {
        observedWhileRunning.push(h.options()?.abortController?.signal.aborted);
        // Cancelling the turn must reach the harness mid-flight, or it keeps
        // running tools after the turn has been marked failed.
        runnerAbort.abort();
        observedWhileRunning.push(h.options()?.abortController?.signal.aborted);
        return [];
      },
    });

    await h.backend.runTurn(PLAN, { abortSignal: runnerAbort.signal });

    expect(h.options()?.abortController).toBeInstanceOf(AbortController);
    expect(observedWhileRunning).toEqual([false, true]);
  });

  it("aborts immediately when the turn deadline has already fired", async () => {
    const h = harness({});
    await h.backend.runTurn(PLAN, { abortSignal: AbortSignal.abort() });
    expect(h.options()?.abortController?.signal.aborted).toBe(true);
  });

  it("starts a fresh session when the harness rejects the resume ref", async () => {
    const h = harness({
      failWhenResuming: true,
      script: async () => [
        { type: "assistant", message: { content: [{ type: "text", text: "recovered" }] } },
      ],
    });

    const response = await h.backend.runTurn({ ...PLAN, resumeSessionRef: "gone-session" });

    // Continuity state is a cache, not truth: a stale ref must not fail the
    // turn. The fresh session is seeded from the same Tyrum-owned prompt
    // append, which carries the conversation-state checkpoint.
    expect(h.resumes).toEqual(["gone-session", undefined]);
    expect(h.forgotten).toEqual([true]);
    expect(h.warnings).toContain("harness.session.resume_rejected");
    expect(response.reply).toBe("recovered");
    expect(h.persisted).toHaveLength(1);
  });

  it("does not retry once the resumed session has already started", async () => {
    const h = harness({
      script: async () => {
        // The session emitted its init message before failing, so a retry could
        // re-run tool calls that already had side effects.
        throw new Error("stream closed");
      },
    });

    await expect(h.backend.runTurn({ ...PLAN, resumeSessionRef: "live-session" })).rejects.toThrow(
      "stream closed",
    );
    expect(h.resumes).toEqual(["live-session"]);
    expect(h.forgotten).toEqual([]);
  });

  it("delivers this turn's chunks to a per-turn sink", async () => {
    const turnChunks: UiMessageChunk[] = [];
    const h = harness({
      script: async () => [
        { type: "assistant", message: { content: [{ type: "text", text: "hello" }] } },
      ],
    });
    await h.backend.runTurn(PLAN, { sink: { emitChunk: (chunk) => void turnChunks.push(chunk) } });

    expect(turnChunks.map((c) => c.type)).toEqual([
      "text-start",
      "text-delta",
      "text-end",
      "finish",
    ]);
    // The backend-wide sink is not also written to.
    expect(h.chunks).toEqual([]);
  });

  it("gives a repeated identical call its own approval and its own transcript entry", async () => {
    const h = harness({
      script: async ({ canUseTool, hooks }) => {
        const observe = hooks["PreToolUse"]?.[0]?.hooks[0];
        const post = hooks["PostToolUse"]?.[0]?.hooks[0];
        const run = async (toolUseId: string) => {
          await observe?.(preToolUse("Bash", { command: "rm -rf build" }), toolUseId, {});
          await canUseTool("Bash", { command: "rm -rf build" }, {});
          await post?.(
            { hook_event_name: "PostToolUse", tool_name: "Bash", tool_response: "ok" },
            toolUseId,
            {},
          );
        };
        // The model runs the very same command twice in one turn.
        await run("toolu_1");
        await run("toolu_2");
        return [];
      },
    });
    await h.backend.runTurn(PLAN);

    // Approving one execution is not approving two: each ask must reach the
    // router under its own id, so each gets its own durable approval.
    expect(h.evaluated).toHaveLength(2);
    expect(h.evaluated[0]?.callId).not.toBe(h.evaluated[1]?.callId);

    // ...and both executions must be visible in the audit trail, not collapsed
    // into one entry that understates what ran.
    const parts = h.persisted[0]?.["parts"] as Array<Record<string, unknown>>;
    expect(parts.map((p) => p["toolCallId"])).toEqual(["toolu_1", "toolu_2"]);
    expect(parts.every((p) => p["state"] === "output-available")).toBe(true);
  });

  it("re-asks on a retry rather than inheriting the previous attempt's approval", async () => {
    const askGatedCall = async ({
      canUseTool,
      hooks,
    }: Parameters<NonNullable<Parameters<typeof harness>[0]["script"]>>[0]) => {
      const observe = hooks["PreToolUse"]?.[0]?.hooks[0];
      await observe?.(preToolUse("Bash", { command: "rm -rf build" }), "toolu_1", {});
      await canUseTool("Bash", { command: "rm -rf build" }, {});
      return [];
    };

    const h = harness({ script: askGatedCall });
    // The same turn runs twice — the turn runner retries under one turn id.
    await h.backend.runTurn(PLAN);
    await h.backend.runTurn(PLAN);

    expect(h.evaluated).toHaveLength(2);
    // The approval key is scoped by turn id, so identical ask ids across
    // attempts would rebuild the first attempt's key and hand back its
    // already-resolved approval, executing the retry without asking anyone.
    expect(h.evaluated[0]?.callId).not.toBe(h.evaluated[1]?.callId);
  });

  it("does not bind a later ask to a call that never reached the ask channel", async () => {
    const h = harness({
      decision: { kind: "deny", reason: "no", approvalId: "approval-1" },
      script: async ({ canUseTool, hooks }) => {
        const observe = hooks["PreToolUse"]?.[0]?.hooks[0];
        const post = hooks["PostToolUse"]?.[0]?.hooks[0];

        // The SDK blocks a call whose PreToolUse hook times out, so canUseTool
        // never runs for it — but the call still terminates.
        await observe?.(preToolUse("Bash", { command: "ls" }), "toolu_stuck", {});
        await post?.(
          { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" } },
          "toolu_stuck",
          {},
        );

        // A later identical call must not inherit the stranded id.
        await observe?.(preToolUse("Bash", { command: "ls" }), "toolu_next", {});
        await canUseTool("Bash", { command: "ls" }, {});
        return [];
      },
    });
    await h.backend.runTurn(PLAN);

    const parts = h.persisted[0]?.["parts"] as Array<Record<string, unknown>>;
    const stranded = parts.find((p) => p["toolCallId"] === "toolu_stuck");
    const gated = parts.find((p) => p["toolCallId"] === "toolu_next");
    // The denial belongs to the call that was actually asked about, not to the
    // one that terminated without ever reaching the ask channel.
    expect(stranded?.["state"]).not.toBe("output-denied");
    expect(gated?.["state"]).toBe("output-denied");
  });
});
