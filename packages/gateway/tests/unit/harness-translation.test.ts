import { describe, expect, it } from "vitest";
import {
  createHarnessTranslator,
  type UiMessageChunk,
} from "../../src/modules/harness/translation.js";

function translator() {
  const chunks: UiMessageChunk[] = [];
  let seq = 0;
  const instance = createHarnessTranslator({
    sink: { emitChunk: (chunk) => void chunks.push(chunk) },
    newId: () => `t${++seq}`,
  });
  return { instance, chunks, types: () => chunks.map((chunk) => chunk.type) };
}

const CALL = { callId: "call-1", toolName: "Bash", input: { command: "ls" } };

describe("createHarnessTranslator", () => {
  it("streams assistant text as start/delta/end and accumulates the reply", async () => {
    const { instance, chunks, types } = translator();
    await instance.handle({ kind: "assistant_text", text: "Hello " });
    await instance.handle({ kind: "assistant_text", text: "world" });
    await instance.handle({ kind: "turn_completed", reply: "", usedTools: [] });

    expect(types()).toEqual(["text-start", "text-delta", "text-delta", "text-end", "finish"]);
    expect(chunks[1]).toMatchObject({ type: "text-delta", id: "t1", delta: "Hello " });
    expect(instance.replyText()).toBe("Hello world");
    expect(instance.assistantParts()).toEqual([
      { type: "text", text: "Hello world", state: "done" },
    ]);
  });

  it("emits a tool part and its output, and records the tool as used", async () => {
    const { instance, types } = translator();
    await instance.handle({ kind: "tool_call", call: CALL });
    await instance.handle({
      kind: "tool_result",
      callId: "call-1",
      toolName: "Bash",
      ok: true,
      content: "a.txt",
    });

    expect(types()).toEqual(["tool-input-available", "tool-output-available"]);
    expect(instance.usedTools()).toEqual(["Bash"]);
    expect(instance.assistantParts()).toEqual([
      {
        type: "tool-Bash",
        toolCallId: "call-1",
        state: "output-available",
        input: { command: "ls" },
        output: "a.txt",
      },
    ]);
  });

  it("surfaces a pending approval, then marks the part approved", async () => {
    const { instance, types } = translator();
    await instance.handle({ kind: "tool_call", call: CALL });
    await instance.notePendingApproval({ callId: "call-1", approvalId: "approval-1" });
    await instance.handle({
      kind: "approval_resolved",
      callId: "call-1",
      toolName: "Bash",
      decision: { kind: "allow", approvalId: "approval-1" },
    });

    expect(types()).toEqual(["tool-input-available", "tool-approval-request"]);
    expect(instance.assistantParts()[0]).toMatchObject({
      approval: { id: "approval-1", approved: true },
    });
  });

  it("marks a denied call as output-denied with the operator's reason", async () => {
    const { instance, types } = translator();
    await instance.handle({ kind: "tool_call", call: CALL });
    await instance.notePendingApproval({ callId: "call-1", approvalId: "approval-1" });
    await instance.handle({
      kind: "approval_resolved",
      callId: "call-1",
      toolName: "Bash",
      decision: { kind: "deny", reason: "too destructive", approvalId: "approval-1" },
    });

    expect(types()).toEqual([
      "tool-input-available",
      "tool-approval-request",
      "tool-output-denied",
    ]);
    expect(instance.assistantParts()[0]).toMatchObject({
      state: "output-denied",
      errorText: "too destructive",
      approval: { id: "approval-1", approved: false },
    });
  });

  it("closes an open text block before a tool call so ordering is preserved", async () => {
    const { instance, types } = translator();
    await instance.handle({ kind: "assistant_text", text: "checking" });
    await instance.handle({ kind: "tool_call", call: CALL });

    expect(types()).toEqual(["text-start", "text-delta", "text-end", "tool-input-available"]);
  });

  it("records a harness error in the durable transcript, not just the stream", async () => {
    const { instance, types } = translator();
    await instance.handle({ kind: "assistant_text", text: "partial" });
    await instance.handle({ kind: "error", message: "harness crashed" });

    expect(types()).toEqual(["text-start", "text-delta", "text-end", "error"]);
    // The failure cause must survive a history reload, and no part may be left
    // stuck mid-stream.
    expect(instance.assistantParts()).toEqual([
      { type: "text", text: "partial", state: "done" },
      { type: "harness-error", errorText: "harness crashed" },
    ]);
  });

  it("reports a failed tool result as an output error", async () => {
    const { instance, chunks } = translator();
    await instance.handle({ kind: "tool_call", call: CALL });
    await instance.handle({
      kind: "tool_result",
      callId: "call-1",
      toolName: "Bash",
      ok: false,
      content: "exit 1",
    });

    expect(chunks[1]).toEqual({
      type: "tool-output-error",
      toolCallId: "call-1",
      errorText: "exit 1",
    });
  });
});
