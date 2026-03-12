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

  it("uses compact transcript card and composer spacing classes", () => {
    const linkedApprovalId = "33333333-3333-3333-3333-333333333333";
    const standaloneApprovalId = "44444444-4444-4444-4444-444444444444";
    const toolCallId = "tool-call-3";
    const testRoot = renderIntoDocument(
      React.createElement(ChatConversationPanel, {
        activeThreadId: "thread-1",
        transcript: [
          {
            kind: "text",
            id: "turn-compact",
            role: "assistant",
            content: "Compact transcript text",
            created_at: "2026-03-10T00:00:00.000Z",
          },
          {
            kind: "tool",
            id: toolCallId,
            tool_id: "shell.exec",
            tool_call_id: toolCallId,
            status: "awaiting_approval",
            summary: "Waiting for approval",
            created_at: "2026-03-10T00:00:01.000Z",
            updated_at: "2026-03-10T00:00:02.000Z",
          },
          {
            kind: "approval",
            id: linkedApprovalId,
            approval_id: linkedApprovalId,
            status: "pending",
            title: "Linked approval required",
            detail: "Approve the linked tool call?",
            created_at: "2026-03-10T00:00:01.000Z",
            updated_at: "2026-03-10T00:00:02.000Z",
          },
          {
            kind: "reasoning",
            id: "reasoning-compact",
            content: "Reasoning content",
            created_at: "2026-03-10T00:00:02.000Z",
            updated_at: "2026-03-10T00:00:03.000Z",
          },
          {
            kind: "approval",
            id: standaloneApprovalId,
            approval_id: standaloneApprovalId,
            status: "pending",
            title: "Standalone approval",
            detail: "Approve the standalone step?",
            created_at: "2026-03-10T00:00:03.000Z",
            updated_at: "2026-03-10T00:00:04.000Z",
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
        draft: "compact draft",
        setDraft: () => {},
        send: async () => {},
        sendBusy: false,
        canSend: true,
        working: false,
        approvalsById: {
          [linkedApprovalId]: {
            approval_id: linkedApprovalId,
            approval_key: "approval:3",
            kind: "workflow_step",
            status: "pending",
            prompt: "Approve the linked tool call?",
            context: {
              tool_call_id: toolCallId,
            },
            created_at: "2026-03-10T00:00:01.000Z",
            expires_at: null,
            resolution: null,
          },
        },
        onResolveApproval: () => {},
        resolvingApproval: null,
      }),
    );

    const transcript = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="chat-transcript"]',
    );
    const transcriptList = transcript?.querySelector<HTMLElement>("div.grid");
    const composer = testRoot.container.querySelector<HTMLTextAreaElement>("textarea");
    const composerShell = composer?.closest<HTMLElement>("div.border-t");
    const composerRow = composer?.parentElement;
    const sendButton = composerRow?.querySelector<HTMLButtonElement>("button") ?? null;
    const copyButton = testRoot.container.querySelector<HTMLButtonElement>(
      'button[title="Copy message"]',
    );
    const textCard = copyButton?.closest<HTMLElement>("div.group.relative.rounded-lg");
    const toolCard = testRoot.container.querySelector<HTMLElement>(
      `[data-testid="chat-tool-card-${toolCallId}"]`,
    );
    const toolApproval = testRoot.container.querySelector<HTMLElement>(
      `[data-testid="chat-tool-approval-${linkedApprovalId}"]`,
    );
    const reasoningCard = transcript?.querySelector<HTMLElement>("details");
    const standaloneApprovalCard = testRoot.container.querySelector<HTMLElement>(
      `[data-testid="chat-approval-card-${standaloneApprovalId}"]`,
    );

    expect(transcript?.className).toContain("p-2");
    expect(transcript?.className).not.toContain("px-3");
    expect(transcriptList?.className).toContain("gap-1.5");
    expect(composerShell?.className).toContain("p-2");
    expect(composerRow?.className).toContain("gap-2");
    expect(composer?.className).toContain("px-2.5");
    expect(composer?.className).toContain("py-2");
    expect(sendButton?.className).toContain("h-[44px]");
    expect(sendButton?.className).toContain("px-4");
    expect(textCard?.className).toContain("px-2");
    expect(textCard?.className).toContain("py-1.5");
    expect(textCard?.className).not.toContain("px-3");
    expect(toolCard?.className).toContain("px-2");
    expect(toolCard?.className).toContain("py-1.5");
    expect(toolApproval?.className).toContain("px-2");
    expect(toolApproval?.className).toContain("py-1.5");
    expect(reasoningCard?.className).toContain("px-2");
    expect(reasoningCard?.className).toContain("py-1.5");
    expect(standaloneApprovalCard?.className).toContain("px-2");
    expect(standaloneApprovalCard?.className).toContain("py-1.5");

    cleanupTestRoot(testRoot);
  });
});
