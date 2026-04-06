import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { ConversationQueueInterruptError } from "../../src/modules/conversation-queue/queue-signal-dal.js";
import {
  prepareConversationQueueStep,
  type ConversationQueueState,
} from "../../src/modules/agent/runtime/turn-engine-bridge.js";

describe("turn-engine-bridge prepareConversationQueueStep", () => {
  it("injects pending conversation queue texts and clears state", () => {
    const queueState = {
      target: { key: "test-key" },
      signals: {} as never,
      interruptError: undefined,
      cancelToolCalls: true,
      pendingInjectionTexts: ["hello", "world"],
    } as unknown as ConversationQueueState;

    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "original" }],
      },
    ];

    const result = prepareConversationQueueStep(queueState, messages);

    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]).toEqual(messages[0]);
    expect(result.messages[1]).toEqual({
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });
    expect(result.messages[2]).toEqual({
      role: "user",
      content: [{ type: "text", text: "world" }],
    });
    expect(queueState.pendingInjectionTexts).toEqual([]);
    expect(queueState.cancelToolCalls).toBe(false);
  });

  it("clears cancelToolCalls even without injections", () => {
    const queueState = {
      target: { key: "test-key" },
      signals: {} as never,
      interruptError: undefined,
      cancelToolCalls: true,
      pendingInjectionTexts: [],
    } as unknown as ConversationQueueState;

    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "original" }],
      },
    ];

    const result = prepareConversationQueueStep(queueState, messages);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual(messages[0]);
    expect(queueState.pendingInjectionTexts).toEqual([]);
    expect(queueState.cancelToolCalls).toBe(false);
  });

  it("throws conversation queue interrupt errors", () => {
    const interruptError = new ConversationQueueInterruptError("boom");
    const queueState = {
      target: { key: "test-key" },
      signals: {} as never,
      interruptError,
      cancelToolCalls: false,
      pendingInjectionTexts: [],
    } as unknown as ConversationQueueState;

    expect(() => prepareConversationQueueStep(queueState, [])).toThrow(interruptError);
  });
});
