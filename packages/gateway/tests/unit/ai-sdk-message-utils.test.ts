import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import {
  appendToolApprovalResponseMessage,
  coerceModelMessages,
  countAssistantMessages,
  hasToolApprovalResponse,
  hasToolResult,
  modelMessagesToChatMessages,
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
          { type: "tool-result", toolCallId: "tc-1", toolName: "bash", output: { ok: true } },
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

  it("normalizes raw tool call and result messages into one assistant tool part", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Searching now" },
          {
            type: "tool-call",
            toolCallId: "tc-websearch-1",
            toolName: "websearch",
            input: { query: "latest docs" },
            title: "Web Search",
          },
        ],
      } as unknown as ModelMessage,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc-websearch-1",
            toolName: "websearch",
            input: { query: "latest docs" },
            output: { hits: 3 },
            title: "Web Search",
          },
        ],
      } as unknown as ModelMessage,
    ];

    const normalized = modelMessagesToChatMessages(messages);

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      role: "assistant",
      parts: [
        { type: "text", text: "Searching now" },
        {
          type: "tool-websearch",
          toolCallId: "tc-websearch-1",
          state: "output-available",
          input: { query: "latest docs" },
          output: { hits: 3 },
          title: "Web Search",
        },
      ],
    });
  });

  it("synthesizes an assistant tool part for orphan raw tool results", () => {
    const messages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc-websearch-orphan-1",
            toolName: "websearch",
            input: { query: "latest docs" },
            output: { hits: 1 },
            title: "Web Search",
          },
        ],
      } as unknown as ModelMessage,
    ];

    const normalized = modelMessagesToChatMessages(messages);

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      role: "assistant",
      parts: [
        {
          type: "tool-websearch",
          toolCallId: "tc-websearch-orphan-1",
          state: "output-available",
          input: { query: "latest docs" },
          output: { hits: 1 },
          title: "Web Search",
        },
      ],
    });
  });

  it("preserves dynamic tool calls and approval requests", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            dynamic: true,
            toolCallId: "tc-dynamic-1",
            toolName: "websearch",
            input: { query: "latest docs" },
            title: "Web Search",
          },
          {
            type: "tool-approval-request",
            approvalId: "approval-1",
            toolCallId: "tc-dynamic-1",
          },
        ],
      } as unknown as ModelMessage,
    ];

    const normalized = modelMessagesToChatMessages(messages);

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "websearch",
          toolCallId: "tc-dynamic-1",
          state: "approval-requested",
          input: { query: "latest docs" },
          approval: { id: "approval-1" },
          title: "Web Search",
        },
      ],
    });
  });
});
