// @vitest-environment jsdom

import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import {
  flushEffects,
  hydrateActiveSessionMock,
  mountConversation,
  useChatMock,
} from "./chat-page-ai-sdk-conversation.test-support.js";
import { cleanupTestRoot } from "../test-utils.js";

function makeUseChatState() {
  return {
    messages: [] as UIMessage[],
    status: "ready" as const,
    error: null,
    sendMessage: vi.fn(async () => undefined),
    setMessages: vi.fn(),
    stop: vi.fn(async () => undefined),
  };
}

function makeSessionClient() {
  let currentQueueMode = "steer";
  return {
    get: vi.fn(async () => ({
      conversation_id: "session-1",
      queue_mode: currentQueueMode,
      messages: [],
    })),
    setQueueMode: vi.fn(async ({ queue_mode }: { queue_mode: string }) => {
      currentQueueMode = queue_mode;
      return {
        conversation_id: "session-1",
        queue_mode,
      };
    }),
  };
}

describe("AiSdkConversation queue mode", () => {
  beforeEach(() => {
    useChatMock.mockReset();
    hydrateActiveSessionMock.mockReset();
  });

  it("ignores stale queue mode completions after navigation", async () => {
    useChatMock.mockReturnValue(makeUseChatState());

    let resolveQueueMode:
      | ((value: { queue_mode: "interrupt"; conversation_id: "session-1" }) => void)
      | undefined;
    const sessionClient = makeSessionClient();
    sessionClient.setQueueMode.mockImplementation(
      () =>
        new Promise<{ queue_mode: "interrupt"; conversation_id: "session-1" }>((resolve) => {
          resolveQueueMode = resolve;
        }),
    );

    let active = {
      sessionId: "session-1",
      session: {
        conversation_id: "session-1",
        thread_id: "thread-1",
        queue_mode: "steer" as const,
        messages: [] as UIMessage[],
      },
    };
    const core = {
      admin: {},
      http: {},
      chatStore: {
        getSnapshot: () => ({ active }),
        hydrateActiveSession: hydrateActiveSessionMock,
      },
    };

    const testRoot = await mountConversation({
      core,
      conversation: {
        conversation_id: "session-1",
        thread_id: "thread-1",
        queue_mode: "steer",
        messages: [],
      },
      conversationClient: sessionClient,
    });
    const queueMode = testRoot.root.container.querySelector(
      "[data-testid='ai-sdk-chat-queue-mode']",
    ) as HTMLSelectElement;

    await act(async () => {
      queueMode.value = "interrupt";
      queueMode.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await flushEffects();

    active = {
      sessionId: "session-2",
      session: {
        conversation_id: "session-2",
        thread_id: "thread-2",
        queue_mode: "followup" as const,
        messages: [],
      },
    };
    testRoot.rerender({
      core,
      conversation: {
        conversation_id: "session-2",
        thread_id: "thread-2",
        queue_mode: "followup",
        messages: [],
      },
    });
    await flushEffects();

    let nextQueueMode = testRoot.root.container.querySelector(
      "[data-testid='ai-sdk-chat-queue-mode']",
    ) as HTMLSelectElement;
    expect(nextQueueMode.value).toBe("followup");
    expect(nextQueueMode.disabled).toBe(false);

    await act(async () => {
      resolveQueueMode?.({
        conversation_id: "session-1",
        queue_mode: "interrupt",
      });
      await Promise.resolve();
    });
    await flushEffects();

    nextQueueMode = testRoot.root.container.querySelector(
      "[data-testid='ai-sdk-chat-queue-mode']",
    ) as HTMLSelectElement;
    expect(hydrateActiveSessionMock).not.toHaveBeenCalled();
    expect(nextQueueMode.value).toBe("followup");
    expect(nextQueueMode.disabled).toBe(false);

    cleanupTestRoot(testRoot.root);
  });
});
