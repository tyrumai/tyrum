// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createChatStore } from "../../../operator-core/src/stores/chat-store.js";
import { createStore } from "../../../operator-core/src/store.js";
import { ChatPage } from "../../src/components/pages/chat-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("ChatPage", () => {
  it("derives thread titles from the last turn even when the last turn is assistant", async () => {
    const ws = {
      sessionList: vi.fn().mockResolvedValue({
        sessions: [
          {
            agent_id: "default",
            session_id: "ui:thread-1",
            channel: "ui",
            thread_id: "ui-550e8400-e29b-41d4-a716-446655440000",
            summary: "",
            last_turn: { role: "assistant", content: "Assistant title\nMore details" },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        next_cursor: null,
      }),
    };

    const http = {};

    const chatStore = createChatStore(ws as never, http as never);
    await chatStore.refreshSessions();

    const { store: connectionStore } = createStore({
      status: "disconnected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });

    const core = { connectionStore, chatStore } as unknown as OperatorCore;
    const testRoot = renderIntoDocument(React.createElement(ChatPage, { core }));

    const threadButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="chat-thread-ui:thread-1"]',
    );
    expect(threadButton).not.toBeNull();

    const title = threadButton?.querySelector<HTMLDivElement>("div.text-sm.font-medium");
    expect(title?.textContent?.trim()).toBe("Assistant title");

    cleanupTestRoot(testRoot);
  });
});
