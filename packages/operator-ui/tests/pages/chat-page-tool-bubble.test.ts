// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import { ChatConversationPanel } from "../../src/components/pages/chat-page-parts.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("ChatPage tool call bubbles", () => {
  it("fades in the transcript copy button on hover", () => {
    const testRoot = renderIntoDocument(
      React.createElement(ChatConversationPanel, {
        activeThreadId: "thread-1",
        transcript: [
          {
            kind: "text",
            id: "turn-1",
            role: "assistant",
            content: "Copied text",
            created_at: new Date().toISOString(),
          },
        ],
        renderMode: "markdown",
        onRenderModeChange: () => {},
        reasoningMode: "collapsed",
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
      }),
    );

    const copyButton = testRoot.container.querySelector<HTMLButtonElement>(
      'button[title="Copy message"]',
    );

    expect(copyButton).not.toBeNull();
    expect(copyButton?.className).toContain("opacity-0");
    expect(copyButton?.className).toContain("group-hover:opacity-100");
    expect(copyButton?.className).toContain("transition-opacity");

    cleanupTestRoot(testRoot);
  });

  it("groups linked tool approvals into a single tool card", () => {
    const approvalId = "11111111-1111-1111-1111-111111111111";
    const toolCallId = "tool-call-1";
    const approval = {
      approval_id: approvalId,
      approval_key: "approval:1",
      kind: "workflow_step",
      status: "pending",
      prompt: "Allow the tool call?",
      context: {
        tool_call_id: toolCallId,
      },
      created_at: "2026-03-10T00:00:00.000Z",
      expires_at: null,
      resolution: null,
    } as const;

    const testRoot = renderIntoDocument(
      React.createElement(ChatConversationPanel, {
        activeThreadId: "thread-1",
        transcript: [
          {
            kind: "tool",
            id: toolCallId,
            tool_id: "shell.exec",
            tool_call_id: toolCallId,
            status: "awaiting_approval",
            summary: "Waiting for approval",
            created_at: "2026-03-10T00:00:00.000Z",
            updated_at: "2026-03-10T00:00:01.000Z",
          },
          {
            kind: "approval",
            id: approvalId,
            approval_id: approvalId,
            status: "pending",
            title: "Approval required",
            detail: approval.prompt,
            created_at: approval.created_at,
            updated_at: "2026-03-10T00:00:01.000Z",
          },
        ],
        renderMode: "markdown",
        onRenderModeChange: () => {},
        reasoningMode: "collapsed",
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
        working: true,
        approvalsById: { [approvalId]: approval },
        onResolveApproval: () => {},
        resolvingApproval: null,
      }),
    );

    const toolCard = testRoot.container.querySelector<HTMLElement>(
      `[data-testid="chat-tool-card-${toolCallId}"]`,
    );

    expect(toolCard).not.toBeNull();
    expect(toolCard?.textContent).toContain("Allow the tool call?");
    expect(
      toolCard?.querySelector(`[data-testid="approval-approve-${approvalId}"]`),
    ).not.toBeNull();
    expect(
      testRoot.container.querySelector(`[data-testid="chat-approval-card-${approvalId}"]`),
    ).toBeNull();
    expect(testRoot.container.textContent).not.toContain("Agent is working");

    cleanupTestRoot(testRoot);
  });

  it("shows resolved approval history inline within the tool card", () => {
    const approvalId = "22222222-2222-2222-2222-222222222222";
    const toolCallId = "tool-call-2";
    const testRoot = renderIntoDocument(
      React.createElement(ChatConversationPanel, {
        activeThreadId: "thread-1",
        transcript: [
          {
            kind: "tool",
            id: toolCallId,
            tool_id: "shell.exec",
            tool_call_id: toolCallId,
            status: "completed",
            summary: "Command finished",
            created_at: "2026-03-10T00:00:00.000Z",
            updated_at: "2026-03-10T00:00:03.000Z",
          },
          {
            kind: "approval",
            id: approvalId,
            approval_id: approvalId,
            tool_call_id: toolCallId,
            status: "approved",
            title: "Approval required",
            detail: "Allow the tool call?",
            created_at: "2026-03-10T00:00:00.000Z",
            updated_at: "2026-03-10T00:00:02.000Z",
          },
        ],
        renderMode: "markdown",
        onRenderModeChange: () => {},
        reasoningMode: "collapsed",
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
        approvalsById: {
          [approvalId]: {
            approval_id: approvalId,
            approval_key: "approval:2",
            kind: "workflow_step",
            status: "approved",
            prompt: "Allow the tool call?",
            context: {
              tool_call_id: toolCallId,
            },
            created_at: "2026-03-10T00:00:00.000Z",
            expires_at: null,
            resolution: {
              decision: "approved",
              resolved_at: "2026-03-10T00:00:02.000Z",
              reason: "Approved for this command",
            },
          },
        },
        onResolveApproval: () => {},
        resolvingApproval: null,
      }),
    );

    const note = testRoot.container.querySelector<HTMLElement>(
      `[data-testid="chat-tool-approval-note-${approvalId}"]`,
    );

    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("Approved");
    expect(note?.textContent).toContain("Approved for this command");
    expect(
      testRoot.container.querySelector(`[data-testid="approval-approve-${approvalId}"]`),
    ).toBeNull();
    expect(
      testRoot.container.querySelector(`[data-testid="chat-approval-card-${approvalId}"]`),
    ).toBeNull();

    cleanupTestRoot(testRoot);
  });
});
