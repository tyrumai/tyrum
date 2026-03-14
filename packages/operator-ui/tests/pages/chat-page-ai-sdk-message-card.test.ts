// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { MessageCard } from "../../src/components/pages/chat-page-ai-sdk-message-card.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const e = React.createElement;

function renderMessageCard(message: UIMessage) {
  return renderIntoDocument(
    e(MessageCard, {
      approvalsById: {},
      message,
      onResolveApproval: vi.fn(),
      reasoningMode: "collapsed",
      renderMode: "text",
      resolvingApproval: null,
    }),
  );
}

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

  it("hides step-start parts instead of rendering an unsupported fallback", () => {
    const testRoot = renderMessageCard({
      id: "assistant-step-start",
      role: "assistant",
      parts: [{ type: "step-start" }],
    } as unknown as UIMessage);

    expect(testRoot.container.textContent).not.toContain("Unsupported part");
    expect(testRoot.container.textContent).toContain("assistant");

    cleanupTestRoot(testRoot);
  });

  it("renders source URLs without falling back to unsupported part text", () => {
    const testRoot = renderMessageCard({
      id: "assistant-source-url",
      role: "assistant",
      parts: [
        {
          type: "source-url",
          sourceId: "source-1",
          title: "Example",
          url: "https://example.com/reference",
        },
      ],
    } as unknown as UIMessage);

    const link = testRoot.container.querySelector(
      "a[href='https://example.com/reference']",
    ) as HTMLAnchorElement | null;

    expect(testRoot.container.textContent).toContain("Source");
    expect(testRoot.container.textContent).toContain("Example");
    expect(testRoot.container.textContent).not.toContain("Unsupported part");
    expect(link?.textContent).toBe("https://example.com/reference");

    cleanupTestRoot(testRoot);
  });

  it("renders source documents without falling back to unsupported part text", () => {
    const testRoot = renderMessageCard({
      id: "assistant-source-document",
      role: "assistant",
      parts: [
        {
          type: "source-document",
          sourceId: "source-doc-1",
          title: "Design Spec",
          mediaType: "application/pdf",
          filename: "design-spec.pdf",
        },
      ],
    } as unknown as UIMessage);

    expect(testRoot.container.textContent).toContain("Source Document");
    expect(testRoot.container.textContent).toContain("Design Spec");
    expect(testRoot.container.textContent).toContain("application/pdf");
    expect(testRoot.container.textContent).toContain("design-spec.pdf");
    expect(testRoot.container.textContent).not.toContain("Unsupported part");

    cleanupTestRoot(testRoot);
  });

  it("renders file parts without falling back to unsupported part text", () => {
    const testRoot = renderMessageCard({
      id: "assistant-file",
      role: "assistant",
      parts: [
        {
          type: "file",
          mediaType: "image/png",
          filename: "diagram.png",
          url: "https://example.com/files/diagram.png",
        },
      ],
    } as unknown as UIMessage);

    const link = testRoot.container.querySelector(
      "a[href='https://example.com/files/diagram.png']",
    ) as HTMLAnchorElement | null;

    expect(testRoot.container.textContent).toContain("File");
    expect(testRoot.container.textContent).toContain("diagram.png");
    expect(testRoot.container.textContent).toContain("image/png");
    expect(testRoot.container.textContent).not.toContain("Unsupported part");
    expect(link?.textContent).toBe("https://example.com/files/diagram.png");

    cleanupTestRoot(testRoot);
  });

  it("renders dynamic tool parts through the existing tool path", () => {
    const testRoot = renderMessageCard({
      id: "assistant-dynamic-tool",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "web_search",
          toolCallId: "tool-call-1",
          state: "output-available",
          input: { query: "latest docs" },
          output: { result: "ok" },
        },
      ],
    } as unknown as UIMessage);

    expect(testRoot.container.textContent).toContain("web_search");
    expect(testRoot.container.textContent).toContain("call tool-call-1");
    expect(testRoot.container.textContent).toContain("output available");
    expect(testRoot.container.textContent).toContain("latest docs");
    expect(testRoot.container.textContent).toContain("result");
    expect(testRoot.container.textContent).not.toContain("Unsupported part");

    cleanupTestRoot(testRoot);
  });
});
