import { describe, expect, it } from "vitest";
import { CONTEXT, PLAN, harness, preToolUse } from "./harness-claude-agent-sdk.fixture.js";

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
