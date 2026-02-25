import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import {
  appendToolApprovalResponseMessage,
  coerceModelMessages,
  countAssistantMessages,
  hasToolApprovalResponse,
  hasToolResult,
} from "../../src/modules/ai-sdk/message-utils.js";

describe("AI SDK message utils", () => {
  it("coerces only valid model messages", () => {
    const messages = coerceModelMessages([
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "{}" }] },
    ]);
    expect(messages).toHaveLength(2);

    expect(coerceModelMessages([{ content: [] }])).toBeUndefined();
    expect(coerceModelMessages("nope")).toBeUndefined();
  });

  it("detects tool approval responses and tool results", () => {
    const messages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          { type: "tool-approval-response", approvalId: "approval-1", approved: true },
          { type: "tool-result", toolCallId: "tc-1", toolName: "tool.exec", output: { ok: true } },
        ],
      } as unknown as ModelMessage,
    ];

    expect(hasToolApprovalResponse(messages, "approval-1")).toBe(true);
    expect(hasToolApprovalResponse(messages, "missing")).toBe(false);
    expect(hasToolResult(messages, "tc-1")).toBe(true);
    expect(hasToolResult(messages, "tc-2")).toBe(false);
  });

  it("appends approval response messages once", () => {
    const base: ModelMessage[] = [
      { role: "assistant", content: [{ type: "text", text: "call tool" }] },
    ];
    const appended = appendToolApprovalResponseMessage(base, {
      approvalId: "approval-2",
      approved: false,
      reason: "denied",
    });

    expect(hasToolApprovalResponse(appended, "approval-2")).toBe(true);
    expect(appended).toHaveLength(2);

    const deduped = appendToolApprovalResponseMessage(appended, {
      approvalId: "approval-2",
      approved: false,
      reason: "still denied",
    });
    expect(deduped).toHaveLength(2);
  });

  it("counts assistant messages", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "again" }] },
    ];
    expect(countAssistantMessages(messages)).toBe(2);
  });
});
