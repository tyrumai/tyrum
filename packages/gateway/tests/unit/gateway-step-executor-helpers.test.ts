import { describe, expect, it } from "vitest";
import { extractToolApprovalResumeState } from "../../src/modules/execution/gateway-step-executor-helpers.js";

describe("extractToolApprovalResumeState", () => {
  it("returns undefined for null context", () => {
    expect(extractToolApprovalResumeState(null)).toBeUndefined();
  });

  it("returns undefined for undefined context", () => {
    expect(extractToolApprovalResumeState(undefined)).toBeUndefined();
  });

  it("returns undefined for non-object context", () => {
    expect(extractToolApprovalResumeState("string")).toBeUndefined();
    expect(extractToolApprovalResumeState(42)).toBeUndefined();
  });

  it("returns undefined when source is not 'llm-step-tool-execution'", () => {
    expect(extractToolApprovalResumeState({ source: "other" })).toBeUndefined();
  });

  it("returns undefined when ai_sdk is missing", () => {
    expect(extractToolApprovalResumeState({ source: "llm-step-tool-execution" })).toBeUndefined();
  });

  it("returns undefined when ai_sdk is not an object", () => {
    expect(
      extractToolApprovalResumeState({ source: "llm-step-tool-execution", ai_sdk: "nope" }),
    ).toBeUndefined();
  });

  it("returns undefined when approval_id is empty", () => {
    expect(
      extractToolApprovalResumeState({
        source: "llm-step-tool-execution",
        ai_sdk: { approval_id: "", messages: [{ role: "user", content: "hi" }] },
      }),
    ).toBeUndefined();
  });

  it("returns undefined when approval_id is not a string", () => {
    expect(
      extractToolApprovalResumeState({
        source: "llm-step-tool-execution",
        ai_sdk: { approval_id: 123, messages: [] },
      }),
    ).toBeUndefined();
  });

  it("returns undefined when messages is not a valid array", () => {
    expect(
      extractToolApprovalResumeState({
        source: "llm-step-tool-execution",
        ai_sdk: { approval_id: "abc", messages: "not-array" },
      }),
    ).toBeUndefined();
  });

  it("returns state for valid context with approval_id and messages", () => {
    const messages = [{ role: "user", content: "hello" }];
    const result = extractToolApprovalResumeState({
      source: "llm-step-tool-execution",
      ai_sdk: { approval_id: "appr-1", messages },
    });
    expect(result).toBeDefined();
    expect(result!.approval_id).toBe("appr-1");
    expect(result!.messages).toEqual(messages);
    expect(result!.steps_used).toBeUndefined();
    expect(result!.tool_calls_used).toBeUndefined();
    expect(result!.counted_tool_call_ids).toBeUndefined();
  });

  it("parses steps_used and tool_calls_used when valid integers", () => {
    const result = extractToolApprovalResumeState({
      source: "llm-step-tool-execution",
      ai_sdk: {
        approval_id: "appr-2",
        messages: [{ role: "user", content: "hi" }],
        steps_used: 3,
        tool_calls_used: 5,
      },
    });
    expect(result).toBeDefined();
    expect(result!.steps_used).toBe(3);
    expect(result!.tool_calls_used).toBe(5);
  });

  it("ignores non-finite steps_used", () => {
    const result = extractToolApprovalResumeState({
      source: "llm-step-tool-execution",
      ai_sdk: {
        approval_id: "appr-3",
        messages: [{ role: "user", content: "hi" }],
        steps_used: NaN,
        tool_calls_used: Infinity,
      },
    });
    expect(result).toBeDefined();
    expect(result!.steps_used).toBeUndefined();
    expect(result!.tool_calls_used).toBeUndefined();
  });

  it("ignores negative steps_used", () => {
    const result = extractToolApprovalResumeState({
      source: "llm-step-tool-execution",
      ai_sdk: {
        approval_id: "appr-4",
        messages: [{ role: "user", content: "hi" }],
        steps_used: -1,
      },
    });
    expect(result).toBeDefined();
    expect(result!.steps_used).toBeUndefined();
  });

  it("ignores non-integer steps_used", () => {
    const result = extractToolApprovalResumeState({
      source: "llm-step-tool-execution",
      ai_sdk: {
        approval_id: "appr-5",
        messages: [{ role: "user", content: "hi" }],
        steps_used: 1.5,
      },
    });
    expect(result).toBeDefined();
    expect(result!.steps_used).toBeUndefined();
  });

  it("parses counted_tool_call_ids from array of strings", () => {
    const result = extractToolApprovalResumeState({
      source: "llm-step-tool-execution",
      ai_sdk: {
        approval_id: "appr-6",
        messages: [{ role: "user", content: "hi" }],
        counted_tool_call_ids: ["tc-1", "tc-2", 42], // 42 should be filtered out
      },
    });
    expect(result).toBeDefined();
    expect(result!.counted_tool_call_ids).toEqual(["tc-1", "tc-2"]);
  });

  it("returns undefined counted_tool_call_ids when not an array", () => {
    const result = extractToolApprovalResumeState({
      source: "llm-step-tool-execution",
      ai_sdk: {
        approval_id: "appr-7",
        messages: [{ role: "user", content: "hi" }],
        counted_tool_call_ids: "not-array",
      },
    });
    expect(result).toBeDefined();
    expect(result!.counted_tool_call_ids).toBeUndefined();
  });
});
