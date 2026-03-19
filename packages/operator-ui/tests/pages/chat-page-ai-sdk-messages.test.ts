// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { OperatorCore } from "../../../operator-app/src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const e = React.createElement;
const testCore = { admin: {}, http: {} } as unknown as OperatorCore;

vi.mock("../../src/components/pages/chat-page-ai-sdk-message-card.js", () => ({
  MessageCard: ({ message }: { message: { id: string } }) =>
    e("div", { "data-testid": `mock-message-${message.id}` }, message.id),
}));

function createMessage(id: string): UIMessage {
  return {
    id,
    parts: [{ type: "text", text: id }],
    role: "assistant",
  } as unknown as UIMessage;
}

function createProps(
  overrides?: Partial<
    React.ComponentProps<
      typeof import("../../src/components/pages/chat-page-ai-sdk-messages.js").AiSdkChatMessageList
    >
  >,
) {
  return {
    approvalsById: {},
    core: testCore,
    followRequestId: 0,
    messages: [] as UIMessage[],
    onResolveApproval: vi.fn(),
    renderMode: "markdown" as const,
    resolvingApproval: null,
    working: false,
    ...overrides,
  };
}

function installScrollMetrics(
  element: HTMLElement,
  initial: { clientHeight: number; scrollHeight: number; scrollTop: number },
): {
  getScrollTop: () => number;
  setScrollHeight: (value: number) => void;
  setScrollTop: (value: number) => void;
} {
  let scrollTop = initial.scrollTop;
  let scrollHeight = initial.scrollHeight;
  const clientHeight = initial.clientHeight;

  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });

  return {
    getScrollTop: () => scrollTop,
    setScrollHeight(value: number) {
      scrollHeight = value;
    },
    setScrollTop(value: number) {
      scrollTop = value;
    },
  };
}

describe("AiSdkChatMessageList", () => {
  it("renders an empty state when there are no messages", async () => {
    const { AiSdkChatMessageList } =
      await import("../../src/components/pages/chat-page-ai-sdk-messages.js");
    const testRoot = renderIntoDocument(e(AiSdkChatMessageList, createProps()));

    expect(testRoot.container.textContent).toContain("No messages yet.");

    cleanupTestRoot(testRoot);
  });

  it("renders message cards inside the transcript container", async () => {
    const { AiSdkChatMessageList } =
      await import("../../src/components/pages/chat-page-ai-sdk-messages.js");
    const messages = [createMessage("assistant-1")];
    const testRoot = renderIntoDocument(
      e(
        AiSdkChatMessageList,
        createProps({
          messages,
          working: true,
        }),
      ),
    );

    const transcript = testRoot.container.querySelector("[data-testid='ai-sdk-chat-transcript']");
    expect(transcript).not.toBeNull();
    expect(
      testRoot.container.querySelector("[data-testid='mock-message-assistant-1']"),
    ).not.toBeNull();

    cleanupTestRoot(testRoot);
  });

  it("forces the transcript back to the bottom when a new follow request arrives", async () => {
    const { AiSdkChatMessageList } =
      await import("../../src/components/pages/chat-page-ai-sdk-messages.js");
    const messages = [createMessage("assistant-1")];
    const testRoot = renderIntoDocument(
      e(
        AiSdkChatMessageList,
        createProps({
          messages,
        }),
      ),
    );

    const transcript = testRoot.container.querySelector(
      "[data-testid='ai-sdk-chat-transcript']",
    ) as HTMLElement | null;
    expect(transcript).not.toBeNull();
    const scroll = installScrollMetrics(transcript as HTMLElement, {
      clientHeight: 100,
      scrollHeight: 400,
      scrollTop: 400,
    });

    act(() => {
      scroll.setScrollTop(120);
      transcript?.dispatchEvent(new Event("scroll"));
    });

    act(() => {
      testRoot.root.render(
        e(
          AiSdkChatMessageList,
          createProps({
            followRequestId: 1,
            messages,
          }),
        ),
      );
    });

    expect(scroll.getScrollTop()).toBe(400);

    cleanupTestRoot(testRoot);
  });

  it("keeps following streamed updates after a follow request re-enables bottom lock", async () => {
    const { AiSdkChatMessageList } =
      await import("../../src/components/pages/chat-page-ai-sdk-messages.js");
    const initialMessages = [createMessage("assistant-1")];
    const testRoot = renderIntoDocument(
      e(
        AiSdkChatMessageList,
        createProps({
          messages: initialMessages,
        }),
      ),
    );

    const transcript = testRoot.container.querySelector(
      "[data-testid='ai-sdk-chat-transcript']",
    ) as HTMLElement | null;
    expect(transcript).not.toBeNull();
    const scroll = installScrollMetrics(transcript as HTMLElement, {
      clientHeight: 100,
      scrollHeight: 400,
      scrollTop: 400,
    });

    act(() => {
      scroll.setScrollTop(120);
      transcript?.dispatchEvent(new Event("scroll"));
    });

    act(() => {
      testRoot.root.render(
        e(
          AiSdkChatMessageList,
          createProps({
            followRequestId: 1,
            messages: initialMessages,
          }),
        ),
      );
    });
    expect(scroll.getScrollTop()).toBe(400);

    scroll.setScrollHeight(520);
    act(() => {
      testRoot.root.render(
        e(
          AiSdkChatMessageList,
          createProps({
            followRequestId: 1,
            messages: [...initialMessages, createMessage("assistant-2")],
            working: true,
          }),
        ),
      );
    });

    expect(scroll.getScrollTop()).toBe(520);

    cleanupTestRoot(testRoot);
  });

  it("stops following once the user scrolls away from the bottom again", async () => {
    const { AiSdkChatMessageList } =
      await import("../../src/components/pages/chat-page-ai-sdk-messages.js");
    const initialMessages = [createMessage("assistant-1")];
    const testRoot = renderIntoDocument(
      e(
        AiSdkChatMessageList,
        createProps({
          messages: initialMessages,
        }),
      ),
    );

    const transcript = testRoot.container.querySelector(
      "[data-testid='ai-sdk-chat-transcript']",
    ) as HTMLElement | null;
    expect(transcript).not.toBeNull();
    const scroll = installScrollMetrics(transcript as HTMLElement, {
      clientHeight: 100,
      scrollHeight: 400,
      scrollTop: 400,
    });

    act(() => {
      scroll.setScrollTop(120);
      transcript?.dispatchEvent(new Event("scroll"));
    });

    act(() => {
      testRoot.root.render(
        e(
          AiSdkChatMessageList,
          createProps({
            followRequestId: 1,
            messages: initialMessages,
          }),
        ),
      );
    });
    expect(scroll.getScrollTop()).toBe(400);

    act(() => {
      scroll.setScrollTop(180);
      transcript?.dispatchEvent(new Event("scroll"));
    });

    scroll.setScrollHeight(620);
    act(() => {
      testRoot.root.render(
        e(
          AiSdkChatMessageList,
          createProps({
            followRequestId: 1,
            messages: [
              ...initialMessages,
              createMessage("assistant-2"),
              createMessage("assistant-3"),
            ],
            working: true,
          }),
        ),
      );
    });

    expect(scroll.getScrollTop()).toBe(180);

    cleanupTestRoot(testRoot);
  });
});
