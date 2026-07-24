import { describe, expect, it } from "vitest";
import { CONTEXT, PLAN, harness, preToolUse } from "./harness-claude-agent-sdk.fixture.js";

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
});
