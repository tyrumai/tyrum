// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { MessageCard } from "../../src/components/pages/chat-page-ai-sdk-message-card.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const e = React.createElement;

describe("MessageCard", () => {
  it("applies wrap-safe classes to long markdown text blocks", () => {
    const testRoot = renderIntoDocument(
      e(MessageCard, {
        approvalsById: {},
        message: {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "averylongtokenwithoutspaces".repeat(10) }],
        } as unknown as UIMessage,
        onResolveApproval: vi.fn(),
        reasoningMode: "collapsed",
        renderMode: "markdown",
        resolvingApproval: null,
      }),
    );

    const card = testRoot.container.firstElementChild as HTMLElement | null;
    const proseBlock = testRoot.container.querySelector("div.prose") as HTMLElement | null;

    expect(card?.className).toContain("w-full");
    expect(card?.className).toContain("min-w-0");
    expect(proseBlock?.className).toContain("break-words");
    expect(proseBlock?.className).toContain("[overflow-wrap:anywhere]");
    expect(proseBlock?.className).toContain("prose-pre:whitespace-pre-wrap");

    cleanupTestRoot(testRoot);
  });

  it("wraps structured data blocks instead of forcing bubble overflow", () => {
    const testRoot = renderIntoDocument(
      e(MessageCard, {
        approvalsById: {},
        message: {
          id: "assistant-2",
          role: "assistant",
          parts: [
            {
              type: "data-debug",
              data: { payload: "0123456789".repeat(30) },
            },
          ],
        } as unknown as UIMessage,
        onResolveApproval: vi.fn(),
        reasoningMode: "collapsed",
        renderMode: "text",
        resolvingApproval: null,
      }),
    );

    const dataPre = testRoot.container.querySelector("pre") as HTMLElement | null;

    expect(dataPre?.className).toContain("whitespace-pre-wrap");
    expect(dataPre?.className).toContain("break-words");
    expect(dataPre?.className).toContain("[overflow-wrap:anywhere]");

    cleanupTestRoot(testRoot);
  });
});
