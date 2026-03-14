// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { ChatThreadsPanel } from "../../src/components/pages/chat-page-threads.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const e = React.createElement;

describe("ChatThreadsPanel", () => {
  it("renders agent names in the selector while keeping agent ids as option values", () => {
    const testRoot = renderIntoDocument(
      e(ChatThreadsPanel, {
        splitView: true,
        connected: true,
        loading: false,
        agentsLoading: false,
        errorMessage: null,
        threads: [],
        activeSessionId: null,
        onRefresh: vi.fn(),
        onLoadMore: vi.fn(),
        canLoadMore: false,
        onOpenThread: vi.fn(),
        agentId: "writer-agent",
        agents: [
          { agent_id: "writer-agent", label: "Writer (writer)" },
          { agent_id: "reviewer-agent", label: "Reviewer (reviewer)" },
        ],
        onAgentChange: vi.fn(),
        onNewChat: vi.fn(),
      }),
    );

    const select = testRoot.container.querySelector(
      "[data-testid='chat-agent-select']",
    ) as HTMLSelectElement | null;
    const options = Array.from(select?.querySelectorAll("option") ?? []);

    expect(options.map((option) => option.value)).toEqual(["writer-agent", "reviewer-agent"]);
    expect(options.map((option) => option.textContent)).toEqual([
      "Writer (writer)",
      "Reviewer (reviewer)",
    ]);

    cleanupTestRoot(testRoot);
  });
});
