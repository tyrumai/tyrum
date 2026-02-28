import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { LaneQueueInterruptError } from "../../src/modules/lanes/queue-signal-dal.js";
import {
  prepareLaneQueueStep,
  type LaneQueueState,
} from "../../src/modules/agent/runtime/turn-engine-bridge.js";

describe("turn-engine-bridge prepareLaneQueueStep", () => {
  it("injects pending lane queue texts and clears state", () => {
    const laneQueue = {
      scope: { key: "test-key", lane: "main" },
      signals: {} as never,
      interruptError: undefined,
      cancelToolCalls: true,
      pendingInjectionTexts: ["hello", "world"],
    } as unknown as LaneQueueState;

    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "original" }],
      },
    ];

    const result = prepareLaneQueueStep(laneQueue, messages);

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
    expect(laneQueue.pendingInjectionTexts).toEqual([]);
    expect(laneQueue.cancelToolCalls).toBe(false);
  });

  it("clears cancelToolCalls even without injections", () => {
    const laneQueue = {
      scope: { key: "test-key", lane: "main" },
      signals: {} as never,
      interruptError: undefined,
      cancelToolCalls: true,
      pendingInjectionTexts: [],
    } as unknown as LaneQueueState;

    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "original" }],
      },
    ];

    const result = prepareLaneQueueStep(laneQueue, messages);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual(messages[0]);
    expect(laneQueue.pendingInjectionTexts).toEqual([]);
    expect(laneQueue.cancelToolCalls).toBe(false);
  });

  it("throws lane queue interrupt errors", () => {
    const interruptError = new LaneQueueInterruptError("boom");
    const laneQueue = {
      scope: { key: "test-key", lane: "main" },
      signals: {} as never,
      interruptError,
      cancelToolCalls: false,
      pendingInjectionTexts: [],
    } as unknown as LaneQueueState;

    expect(() => prepareLaneQueueStep(laneQueue, [])).toThrow(interruptError);
  });
});
