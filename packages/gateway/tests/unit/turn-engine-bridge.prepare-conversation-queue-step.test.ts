import { describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";
import { ConversationQueueInterruptError } from "../../src/modules/conversation-queue/queue-signal-dal.js";
import { buildAgentTurnKey } from "../../src/modules/agent/turn-key.js";
import {
  prepareConversationQueueStep,
  type ConversationQueueState,
} from "../../src/modules/agent/runtime/turn-engine-bridge.js";
import { prepareTurnExecution } from "../../src/modules/agent/runtime/turn-engine-bridge-execution.js";
import {
  resolveAgentTurnInput,
  resolveConversationQueueTarget,
} from "../../src/modules/agent/runtime/turn-helpers.js";

type CapturedEnqueuePlan = {
  key?: string;
  steps?: Array<{ args?: { metadata?: { work_conversation_key?: string } } }>;
};

function createBridgeDeps() {
  let capturedPlan: CapturedEnqueuePlan | undefined;

  return {
    deps: {
      tenantId: "tenant-1",
      agentKey: "default",
      workspaceKey: "default",
      identityScopeDal: {
        resolveScopeIds: vi.fn().mockResolvedValue({
          tenantId: "tenant-1",
          agentId: "agent-1",
          workspaceId: "workspace-1",
        }),
      },
      executionEngine: {
        enqueuePlan: vi.fn().mockImplementation(async (input: CapturedEnqueuePlan) => {
          capturedPlan = input;
          return { turnId: "turn-1" };
        }),
      },
      executionWorkerId: "worker",
      turnEngineWaitMs: 1_000,
      approvalPollMs: 100,
      db: {
        get: vi.fn().mockResolvedValue(undefined),
      },
      approvalDal: {} as never,
      conversationNodeAttachmentDal: {
        put: vi.fn().mockResolvedValue(undefined),
      },
      redactText: (text: string) => text,
      redactUnknown: <T>(value: T) => value,
      resolveExecutionProfile: vi.fn().mockResolvedValue({
        profile: { budgets: {} },
      }),
      turnDirect: vi.fn(),
      resolveAgentTurnInput: vi.fn(resolveAgentTurnInput),
      resolveConversationQueueTarget: vi.fn(resolveConversationQueueTarget),
      resolveTurnRequestId: vi.fn().mockReturnValue("request-1"),
      isToolExecutionApprovalRequiredError: () => false,
    } as never,
    getCapturedPlan: () => capturedPlan,
  };
}

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

  it("uses the guarded default key for malformed subagent queue targets", async () => {
    const { deps, getCapturedPlan } = createBridgeDeps();
    const expectedKey = buildAgentTurnKey({
      agentId: "default",
      workspaceId: "default",
      channel: "test",
      containerKind: "channel",
      threadId: "thread-1",
    });

    await prepareTurnExecution(deps, {
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
      metadata: { tyrum_key: "agent:default:subagent:bad:key" },
    });

    const capturedPlan = getCapturedPlan();
    expect(capturedPlan?.key).toBe(expectedKey);
    expect(capturedPlan?.steps?.[0]?.args?.metadata?.work_conversation_key).toBe(expectedKey);
  });

  it("uses the validated subagent key for step metadata and enqueueing", async () => {
    const { deps, getCapturedPlan } = createBridgeDeps();
    const subagentKey = "agent:default:subagent:child-1";

    await prepareTurnExecution(deps, {
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
      metadata: { tyrum_key: subagentKey },
    });

    const capturedPlan = getCapturedPlan();
    expect(capturedPlan?.key).toBe(subagentKey);
    expect(capturedPlan?.steps?.[0]?.args?.metadata?.work_conversation_key).toBe(subagentKey);
  });

  it("reuses the prepared turn context instead of resolving queue metadata twice", async () => {
    const { deps } = createBridgeDeps();

    await prepareTurnExecution(deps, {
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
      metadata: { tyrum_key: "agent:default:subagent:child-1" },
    });

    expect(deps.resolveAgentTurnInput).toHaveBeenCalledTimes(1);
    expect(deps.resolveConversationQueueTarget).toHaveBeenCalledTimes(1);
  });
});
