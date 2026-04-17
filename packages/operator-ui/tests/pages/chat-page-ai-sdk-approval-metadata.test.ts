// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { PolicyToolOption } from "../../src/components/pages/admin-http-policy-overrides.shared.js";
import { MessageCard } from "../../src/components/pages/chat-page-ai-sdk-message-card.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const e = React.createElement;

const APPROVAL_TOOL_OPTIONS: PolicyToolOption[] = [
  {
    canonical_id: "tool.desktop.snapshot",
    description: "Capture a desktop snapshot.",
    aliases: [{ id: "tool.desktop.screenshot", lifecycle: "alias" }],
    lifecycle: "canonical",
    visibility: "public",
  },
  {
    canonical_id: "memory.write",
    description: "Write structured memory items.",
    aliases: [{ id: "mcp.memory.write", lifecycle: "deprecated" }],
    lifecycle: "canonical",
    visibility: "public",
  },
];

function renderApprovalMessageCard(
  toolName: string,
  approvalToolOptions?: readonly PolicyToolOption[],
) {
  return renderIntoDocument(
    e(MessageCard, {
      approvalsById: {},
      message: {
        id: `assistant-${toolName}`,
        role: "assistant",
        parts: [
          {
            type: "data-approval-state",
            data: {
              approval_id: `${toolName}-approval`,
              approved: false,
              state: "pending",
              tool_call_id: `${toolName}-call`,
              tool_name: toolName,
            },
          },
        ],
      } as unknown as UIMessage,
      onResolveApproval: vi.fn(),
      renderMode: "text",
      resolvingApproval: null,
      approvalToolOptions,
    }),
  );
}

describe("MessageCard approval metadata", () => {
  it("renders canonical tool metadata in approval request cards", () => {
    const testRoot = renderApprovalMessageCard("tool.desktop.screenshot", APPROVAL_TOOL_OPTIONS);

    expect(testRoot.container.textContent).toContain("Approval request");
    expect(testRoot.container.textContent).toContain("tool.desktop.snapshot");
    expect(testRoot.container.textContent).toContain("tool.desktop.screenshot");
    expect(testRoot.container.textContent).toContain("alias match");
    expect(testRoot.container.textContent).toContain("public");

    cleanupTestRoot(testRoot);
  });

  it("renders deprecated alias state in approval request cards", () => {
    const testRoot = renderApprovalMessageCard("mcp.memory.write", APPROVAL_TOOL_OPTIONS);

    expect(testRoot.container.textContent).toContain("memory.write");
    expect(testRoot.container.textContent).toContain("deprecated alias match");
    expect(testRoot.container.textContent).toContain("public");

    cleanupTestRoot(testRoot);
  });

  it("uses the canonical tool id as the approval-request header and schema key", () => {
    const testRoot = renderIntoDocument(
      e(MessageCard, {
        approvalsById: {
          "approval-4": {
            approval_id: "approval-4",
            approval_key: "approval:4",
            kind: "policy",
            status: "awaiting_human",
            prompt: "Approve snapshot",
            motivation: "Approve snapshot",
            created_at: "2026-01-01T00:00:00.000Z",
            latest_review: null,
          },
        },
        message: {
          id: "assistant-approval-tool-part",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "tool.desktop.screenshot",
              toolCallId: "tool-call-4",
              state: "approval-requested",
              input: { path: "/tmp/snap.png" },
              approval: { id: "approval-4" },
            },
          ],
        } as unknown as UIMessage,
        onResolveApproval: vi.fn(),
        renderMode: "text",
        resolvingApproval: null,
        approvalToolOptions: APPROVAL_TOOL_OPTIONS,
        toolSchemasById: {
          "tool.desktop.snapshot": {
            type: "object",
            properties: {
              path: {
                type: "string",
                title: "Path",
              },
            },
          },
        },
      }),
    );

    const toggle = Array.from(testRoot.container.querySelectorAll("button")).find((button) =>
      button.textContent?.trim().includes("tool.desktop.snapshot"),
    );
    expect(toggle?.textContent?.trim()).toBe("tool.desktop.snapshot");
    expect(testRoot.container.textContent).toContain("Path");
    expect(testRoot.container.textContent).toContain("/tmp/snap.png");

    cleanupTestRoot(testRoot);
  });

  it("keeps raw approval tool ids readable when registry metadata is unavailable", () => {
    const testRoot = renderApprovalMessageCard("mcp.memory.write");

    expect(testRoot.container.textContent).toContain("mcp.memory.write");
    expect(testRoot.container.textContent).toContain(
      "Shared tool metadata unavailable for this approval.",
    );

    cleanupTestRoot(testRoot);
  });
});
