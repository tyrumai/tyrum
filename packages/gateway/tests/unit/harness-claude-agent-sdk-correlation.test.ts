import { describe, expect, it } from "vitest";
import { CONTEXT, PLAN, harness, preToolUse } from "./harness-claude-agent-sdk.fixture.js";

describe("createClaudeAgentSdkBackend ask-to-execution correlation", () => {
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

  it("hands the harness's cancellation signal to the approval wait", async () => {
    const controller = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    const h = harness({
      captureAbortSignal: (signal) => void seen.push(signal),
      script: async ({ canUseTool }) => {
        await canUseTool("Bash", { command: "ls" }, { signal: controller.signal });
        return [];
      },
    });
    await h.backend.runTurn(PLAN);

    // Waiting on a human can take the whole approval window; without the signal
    // a cancelled turn would keep the permission callback blocked throughout.
    expect(seen).toEqual([controller.signal]);
  });

  it("uses the model's own tool-use id when no hook paired the call", async () => {
    const h = harness({
      script: async ({ canUseTool }) => {
        // The assistant message carries the authoritative id; no PreToolUse.
        await canUseTool("Bash", { command: "ls" }, {});
        return [];
      },
      preludeMessages: [
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "toolu_authoritative",
                name: "Bash",
                input: { command: "ls" },
              },
            ],
          },
        },
      ],
    });
    await h.backend.runTurn(PLAN);

    const parts = h.persisted[0]?.["parts"] as Array<Record<string, unknown>>;
    expect(parts.map((p) => p["toolCallId"])).toEqual(["toolu_authoritative"]);
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
