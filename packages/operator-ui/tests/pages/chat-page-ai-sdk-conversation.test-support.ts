// @vitest-environment jsdom

import React, { act } from "react";
import type { UIMessage } from "ai";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { vi } from "vitest";
import { renderIntoDocument, setNativeValue } from "../test-utils.js";

const e = React.createElement;

const useChatMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const hydrateActiveSessionMock = vi.hoisted(() => vi.fn());
export { hydrateActiveSessionMock, toastErrorMock, useChatMock };
export const testCore = {
  http: {},
  chatStore: {
    hydrateActiveSession: hydrateActiveSessionMock,
  },
} as unknown as OperatorCore;

const DRAFT_LINE_HEIGHT_PX = 20;
const DRAFT_PADDING_PX = 8;
const DRAFT_BORDER_PX = 1;

vi.mock("@ai-sdk/react", () => ({
  useChat: useChatMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

vi.mock("../../src/components/pages/chat-page-ai-sdk-messages.js", () => ({
  AiSdkChatMessageList: ({
    followRequestId,
    messages,
  }: {
    followRequestId: number;
    messages: UIMessage[];
  }) =>
    e(
      "div",
      {
        "data-follow-request-id": String(followRequestId),
        "data-testid": "mock-message-list",
      },
      String(messages.length),
    ),
}));

export async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

export function dispatchDraftKeyDown(draft: HTMLTextAreaElement, init: KeyboardEventInit): boolean {
  return draft.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
}

export async function setDraftValue(draft: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    setNativeValue(draft, value);
    await Promise.resolve();
  });
}

export function stubDraftSizing(): () => void {
  const originalGetComputedStyle = window.getComputedStyle.bind(window);
  const computedStyleSpy = vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const styles = originalGetComputedStyle(element);
    if (!(element instanceof HTMLTextAreaElement)) {
      return styles;
    }
    return {
      ...styles,
      lineHeight: `${DRAFT_LINE_HEIGHT_PX}px`,
      fontSize: "14px",
      paddingTop: `${DRAFT_PADDING_PX}px`,
      paddingBottom: `${DRAFT_PADDING_PX}px`,
      borderTopWidth: `${DRAFT_BORDER_PX}px`,
      borderBottomWidth: `${DRAFT_BORDER_PX}px`,
    } as CSSStyleDeclaration;
  });
  const scrollHeightSpy = vi
    .spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get")
    .mockImplementation(function (this: HTMLTextAreaElement) {
      const lineCount = Math.max(this.value.split("\n").length, this.rows || 1);
      return lineCount * DRAFT_LINE_HEIGHT_PX + DRAFT_PADDING_PX * 2;
    });

  return () => {
    computedStyleSpy.mockRestore();
    scrollHeightSpy.mockRestore();
  };
}

export function stubFileReader(): () => void {
  const originalFileReader = globalThis.FileReader;

  class FakeFileReader {
    private readonly listeners = new Map<string, Set<(event: Event) => void>>();

    public error: DOMException | null = null;
    public onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
    public onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    public result: string | ArrayBuffer | null = null;

    addEventListener(type: string, listener: (event: Event) => void): void {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: (event: Event) => void): void {
      this.listeners.get(type)?.delete(listener);
    }

    readAsDataURL(file: Blob): void {
      this.result = `data:${file.type || "application/octet-stream"};base64,stub`;
      const event = { target: this } as unknown as Event;
      this.onload?.(event as unknown as ProgressEvent<FileReader>);
      for (const listener of this.listeners.get("load") ?? []) {
        listener(event);
      }
    }
  }

  vi.stubGlobal("FileReader", FakeFileReader as unknown as typeof FileReader);

  return () => {
    if (typeof originalFileReader === "undefined") {
      vi.unstubAllGlobals();
      return;
    }
    vi.stubGlobal("FileReader", originalFileReader);
  };
}

export function setInputFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function makeConversationProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    approvalsById: {},
    core: testCore,
    onDelete: vi.fn(),
    onResolveApproval: vi.fn(),
    onRenderModeChange: vi.fn(),
    onSessionMessages: vi.fn(),
    renderMode: "markdown",
    resolvingApproval: null,
    resolveAttachedNodeId: vi.fn(async () => null),
    session: {
      session_id: "session-1",
      thread_id: "thread-1",
      messages: [],
    },
    sessionClient: {
      get: vi.fn(async () => ({
        session_id: "session-1",
        messages: [],
      })),
    },
    transport: { transport: true },
    ...overrides,
  };
}

export async function mountConversation(overrides: Record<string, unknown> = {}) {
  const { AiSdkConversation } =
    await import("../../src/components/pages/chat-page-ai-sdk-conversation.js");
  const props = makeConversationProps(overrides);
  const root = renderIntoDocument(e(AiSdkConversation, props as never));

  return {
    props,
    root,
    rerender(nextOverrides: Record<string, unknown> = {}) {
      act(() => {
        root.root.render(e(AiSdkConversation, { ...props, ...nextOverrides } as never));
      });
    },
  };
}
