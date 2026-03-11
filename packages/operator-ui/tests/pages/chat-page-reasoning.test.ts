// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { ChatConversationPanel } from "../../src/components/pages/chat-page-parts.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

function renderPanel(reasoningMode: "collapsed" | "expanded", content: string) {
  return React.createElement(ChatConversationPanel, {
    activeThreadId: "thread-1",
    transcript: [
      {
        kind: "reasoning",
        id: "reason-1",
        content,
        created_at: "2026-03-11T12:00:00.000Z",
        updated_at: "2026-03-11T12:00:01.000Z",
      },
    ],
    renderMode: "markdown",
    onRenderModeChange: () => {},
    reasoningMode,
    onReasoningModeChange: () => {},
    loadError: null,
    sendError: null,
    deleteDisabled: false,
    onDelete: () => {},
    draft: "",
    setDraft: () => {},
    send: async () => {},
    sendBusy: false,
    canSend: false,
    working: false,
    approvalsById: {},
    onResolveApproval: () => {},
    resolvingApproval: null,
  });
}

describe("ChatPage reasoning details", () => {
  it("keeps a manually opened reasoning block open across streaming rerenders", () => {
    const testRoot = renderIntoDocument(renderPanel("collapsed", "first chunk"));
    const reasoning = testRoot.container.querySelector<HTMLDetailsElement>("details");

    expect(reasoning).not.toBeNull();
    expect(reasoning?.open).toBe(false);

    act(() => {
      if (!reasoning) return;
      reasoning.open = true;
      reasoning.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    expect(reasoning?.open).toBe(true);

    act(() => {
      testRoot.root.render(renderPanel("collapsed", "first chunk second chunk"));
    });

    expect(testRoot.container.querySelector<HTMLDetailsElement>("details")?.open).toBe(true);

    act(() => {
      testRoot.root.render(renderPanel("expanded", "first chunk second chunk"));
    });

    expect(testRoot.container.querySelector<HTMLDetailsElement>("details")?.open).toBe(true);

    cleanupTestRoot(testRoot);
  });
});
