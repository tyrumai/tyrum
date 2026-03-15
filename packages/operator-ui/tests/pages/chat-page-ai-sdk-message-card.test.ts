// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { MessageCard } from "../../src/components/pages/chat-page-ai-sdk-message-card.js";
import { click, cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const e = React.createElement;

function renderMessageCard(message: UIMessage, core?: OperatorCore) {
  return renderIntoDocument(
    e(MessageCard, {
      approvalsById: {},
      core,
      message,
      onResolveApproval: vi.fn(),
      renderMode: "text",
      resolvingApproval: null,
    }),
  );
}

function findToggle(container: HTMLElement, label: string): HTMLButtonElement {
  const toggle = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === label,
  );
  expect(toggle).toBeInstanceOf(HTMLButtonElement);
  return toggle as HTMLButtonElement;
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

  it("keeps the reasoning header fixed and lets the user toggle while streaming", () => {
    const testRoot = renderMessageCard({
      id: "assistant-reasoning-streaming",
      role: "assistant",
      parts: [{ type: "reasoning", text: "Inspecting context", state: "streaming" }],
    } as unknown as UIMessage);

    const toggle = findToggle(testRoot.container, "Thinking");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(testRoot.container.textContent).toContain("Inspecting context");

    act(() => {
      click(toggle);
    });
    expect(findToggle(testRoot.container, "Thinking").getAttribute("aria-expanded")).toBe("false");
    expect(testRoot.container.textContent).not.toContain("Inspecting context");

    act(() => {
      click(findToggle(testRoot.container, "Thinking"));
    });
    expect(findToggle(testRoot.container, "Thinking").getAttribute("aria-expanded")).toBe("true");
    expect(testRoot.container.textContent).toContain("Inspecting context");

    cleanupTestRoot(testRoot);
  });

  it("auto-collapses reasoning once streaming completes", () => {
    const message = {
      id: "assistant-reasoning-done",
      role: "assistant",
      parts: [{ type: "reasoning", text: "Inspecting context", state: "streaming" }],
    } as unknown as UIMessage;
    const testRoot = renderMessageCard(message);

    act(() => {
      testRoot.root.render(
        e(MessageCard, {
          approvalsById: {},
          message: {
            ...message,
            parts: [{ type: "reasoning", text: "Inspecting context", state: "done" }],
          },
          onResolveApproval: vi.fn(),
          renderMode: "text",
          resolvingApproval: null,
        }),
      );
    });

    const toggle = findToggle(testRoot.container, "Thinking");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(testRoot.container.textContent).not.toContain("Inspecting context");

    cleanupTestRoot(testRoot);
  });

  it("keeps tool headers to the tool name and lets the user toggle while active", () => {
    const testRoot = renderMessageCard({
      id: "assistant-tool-active",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "web_search",
          toolCallId: "tool-call-1",
          state: "input-available",
          input: { query: "latest docs" },
        },
      ],
    } as unknown as UIMessage);

    const toggle = findToggle(testRoot.container, "web_search");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(testRoot.container.textContent).toContain("latest docs");
    expect(testRoot.container.textContent).not.toContain("tool-call-1");

    act(() => {
      click(toggle);
    });
    expect(findToggle(testRoot.container, "web_search").getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(testRoot.container.textContent).not.toContain("latest docs");
    expect(findToggle(testRoot.container, "web_search").textContent?.trim()).toBe("web_search");

    act(() => {
      click(findToggle(testRoot.container, "web_search"));
    });
    expect(findToggle(testRoot.container, "web_search").getAttribute("aria-expanded")).toBe("true");
    expect(testRoot.container.textContent).toContain("latest docs");

    cleanupTestRoot(testRoot);
  });

  it("auto-collapses tool calls once they finish and only shows input/output when expanded", () => {
    const message = {
      id: "assistant-tool-finished",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "web_search",
          toolCallId: "tool-call-1",
          state: "input-available",
          input: { query: "latest docs" },
        },
      ],
    } as unknown as UIMessage;
    const testRoot = renderMessageCard(message);

    act(() => {
      testRoot.root.render(
        e(MessageCard, {
          approvalsById: {},
          message: {
            ...message,
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
          },
          onResolveApproval: vi.fn(),
          renderMode: "text",
          resolvingApproval: null,
        }),
      );
    });

    const toggle = findToggle(testRoot.container, "web_search");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(testRoot.container.textContent).not.toContain("latest docs");
    expect(testRoot.container.textContent).not.toContain("result");
    expect(testRoot.container.textContent).not.toContain("tool-call-1");

    act(() => {
      click(toggle);
    });
    expect(findToggle(testRoot.container, "web_search").getAttribute("aria-expanded")).toBe("true");
    expect(testRoot.container.textContent).toContain("latest docs");
    expect(testRoot.container.textContent).toContain("result");
    expect(testRoot.container.textContent).not.toContain("tool-call-1");

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

  it("renders inline artifact previews for tool output with a run id", async () => {
    const getBytes = vi.fn(async () => ({
      kind: "bytes" as const,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    }));
    const getMetadata = vi.fn(async () => ({
      artifact: {
        artifact_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        uri: "artifact://aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        kind: "screenshot" as const,
        created_at: "2026-01-01T00:00:00.000Z",
        mime_type: "image/png",
        labels: ["screenshot", "desktop"],
      },
      scope: {
        workspace_id: "default",
        agent_id: "default",
        run_id: "11111111-1111-1111-1111-111111111111",
        step_id: "22222222-2222-2222-2222-222222222222",
        attempt_id: "33333333-3333-3333-3333-333333333333",
        sensitivity: "sensitive",
        policy_snapshot_id: null,
      },
    }));
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:chat-artifact-preview");
    URL.revokeObjectURL = vi.fn();

    const core = {
      httpBaseUrl: "http://example.test",
      http: {
        artifacts: {
          getBytes,
          getMetadata,
        },
      },
    } as unknown as OperatorCore;

    const testRoot = renderMessageCard(
      {
        id: "assistant-tool-artifact",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "tool.node.dispatch",
            toolCallId: "tool-call-2",
            state: "output-available",
            output: {
              run_id: "11111111-1111-1111-1111-111111111111",
              payload: {
                artifact: {
                  artifact_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                  uri: "artifact://aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                  kind: "screenshot",
                  created_at: "2026-01-01T00:00:00.000Z",
                  mime_type: "image/png",
                  labels: ["screenshot", "desktop"],
                },
              },
            },
          },
        ],
      } as unknown as UIMessage,
      core,
    );

    act(() => {
      click(findToggle(testRoot.container, "tool.node.dispatch"));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const preview = testRoot.container.querySelector(
      "[data-testid='artifact-preview-image-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']",
    ) as HTMLImageElement | null;

    expect(preview).not.toBeNull();
    expect(preview?.getAttribute("src")).toBe("blob:chat-artifact-preview");
    expect(getBytes).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(getMetadata).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    cleanupTestRoot(testRoot);
  });
});
