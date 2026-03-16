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

function expectStructuredJsonViewer(container: HTMLElement, rootSummaryText: string): void {
  const rootSummary = Array.from(container.querySelectorAll("summary")).find((summary) =>
    summary.textContent?.includes(rootSummaryText),
  );

  expect(rootSummary).not.toBeUndefined();
  expect(container.querySelector("pre")).toBeNull();
}

describe("MessageCard tool output rendering", () => {
  it("renders bare JSON tool output with the JsonViewer", () => {
    const testRoot = renderMessageCard({
      id: "assistant-tool-json",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "tool.node.list",
          toolCallId: "tool-call-json",
          state: "output-available",
          output: JSON.stringify({
            status: "ok",
            nodes: [{ node_id: "node-1" }],
          }),
        },
      ],
    } as unknown as UIMessage);

    act(() => {
      click(findToggle(testRoot.container, "tool.node.list"));
    });

    expectStructuredJsonViewer(testRoot.container, "root: {2}");
    expect(testRoot.container.textContent).toContain("status");
    expect(testRoot.container.textContent).toContain("nodes");

    cleanupTestRoot(testRoot);
  });

  it("falls back to raw text for non-JSON tool output", () => {
    const testRoot = renderMessageCard({
      id: "assistant-tool-raw",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "shell",
          toolCallId: "tool-call-raw",
          state: "output-available",
          output: "not json",
        },
      ],
    } as unknown as UIMessage);

    act(() => {
      click(findToggle(testRoot.container, "shell"));
    });

    const pre = testRoot.container.querySelector("pre") as HTMLPreElement | null;

    expect(testRoot.container.querySelector("button[aria-label='Copy JSON']")).toBeNull();
    expect(pre?.textContent).toBe("not json");

    cleanupTestRoot(testRoot);
  });

  it("keeps existing object-shaped tool output rendered as structured JSON", () => {
    const testRoot = renderMessageCard({
      id: "assistant-tool-object",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "tool.node.inspect",
          toolCallId: "tool-call-object",
          state: "output-available",
          output: {
            status: "ok",
            actions: [{ name: "screenshot" }],
          },
        },
      ],
    } as unknown as UIMessage);

    act(() => {
      click(findToggle(testRoot.container, "tool.node.inspect"));
    });

    expectStructuredJsonViewer(testRoot.container, "root: {2}");
    expect(testRoot.container.textContent).toContain("actions");
    expect(testRoot.container.textContent).toContain("screenshot");

    cleanupTestRoot(testRoot);
  });

  it("renders inline artifact previews for tagged JSON tool output with a run id", async () => {
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
    const outputJson = JSON.stringify({
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
    });

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
            output: `<data source="tool">\n${outputJson}\n</data>`,
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

    expectStructuredJsonViewer(testRoot.container, "root: {2}");
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

  it("does not parse security-prefixed tagged tool output", () => {
    const rawOutput =
      "[SECURITY: This tool output contained potential prompt injection patterns that were neutralized.]\n" +
      '<data source="tool">\n{"status":"ok"}\n</data>';
    const testRoot = renderMessageCard({
      id: "assistant-tool-security-prefix",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "webfetch",
          toolCallId: "tool-call-security",
          state: "output-available",
          output: rawOutput,
        },
      ],
    } as unknown as UIMessage);

    act(() => {
      click(findToggle(testRoot.container, "webfetch"));
    });

    const pre = testRoot.container.querySelector("pre") as HTMLPreElement | null;

    expect(testRoot.container.querySelector("button[aria-label='Copy JSON']")).toBeNull();
    expect(pre?.textContent).toBe(rawOutput);

    cleanupTestRoot(testRoot);
  });

  it("does not parse partially wrapped tagged tool output", () => {
    const rawOutput = 'prefix <data source="tool">\n{"status":"ok"}\n</data> suffix';
    const testRoot = renderMessageCard({
      id: "assistant-tool-partial-wrapper",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "tool.node.dispatch",
          toolCallId: "tool-call-partial",
          state: "output-available",
          output: rawOutput,
        },
      ],
    } as unknown as UIMessage);

    act(() => {
      click(findToggle(testRoot.container, "tool.node.dispatch"));
    });

    const pre = testRoot.container.querySelector("pre") as HTMLPreElement | null;

    expect(testRoot.container.querySelector("button[aria-label='Copy JSON']")).toBeNull();
    expect(pre?.textContent).toBe(rawOutput);

    cleanupTestRoot(testRoot);
  });
});
