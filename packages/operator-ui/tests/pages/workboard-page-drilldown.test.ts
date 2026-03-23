// @vitest-environment jsdom

import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkBoardDrilldown } from "../../src/components/pages/workboard-page-drilldown.js";
import { cleanupTestRoot, click, renderIntoDocument } from "../test-utils.js";

describe("WorkBoardDrilldown", () => {
  it("uses the item details label for drilldown errors", () => {
    const markup = renderToStaticMarkup(
      React.createElement(WorkBoardDrilldown, {
        selectedWorkItemId: "550e8400-e29b-41d4-a716-446655440001",
        drilldownBusy: false,
        drilldownError: "Unable to load item details.",
        selectedItem: null,
        pendingAction: null,
        canMarkReadySelected: false,
        canPauseSelected: false,
        canResumeSelected: false,
        canEditSelected: false,
        canDeleteSelected: false,
        canCancelSelected: false,
        isReadOnlyLocked: false,
        onTransition: vi.fn(async () => {}),
        onPause: vi.fn(async () => {}),
        onResume: vi.fn(async () => {}),
        onDelete: vi.fn(async () => {}),
        onEdit: vi.fn(),
        taskCounts: {
          leased: 0,
          running: 0,
          paused: 0,
          completed: 0,
          failed: 0,
          cancelled: 0,
        },
        taskList: [],
        approvalBlockers: [],
        decisions: [],
        artifacts: [],
        signals: [],
        agentKvEntries: [],
        workItemKvEntries: [],
      }),
    );

    expect(markup).toContain("Item details error");
    expect(markup).not.toContain("Drilldown error");
  });

  it("renders pause detail even when it is the only task detail field", () => {
    const markup = renderToStaticMarkup(
      React.createElement(WorkBoardDrilldown, {
        selectedWorkItemId: "550e8400-e29b-41d4-a716-446655440001",
        drilldownBusy: false,
        drilldownError: null,
        selectedItem: {
          work_item_id: "550e8400-e29b-41d4-a716-446655440001",
          tenant_id: "tenant-test",
          agent_id: "00000000-0000-4000-8000-000000000001",
          workspace_id: "workspace-test",
          kind: "action",
          title: "Review task pause detail",
          status: "doing",
          priority: 1,
          created_at: "2026-03-21T12:00:00.000Z",
          created_from_session_key: "session.test",
          last_active_at: null,
        },
        pendingAction: null,
        canMarkReadySelected: false,
        canPauseSelected: false,
        canResumeSelected: false,
        canEditSelected: false,
        canDeleteSelected: false,
        canCancelSelected: false,
        isReadOnlyLocked: false,
        onTransition: vi.fn(async () => {}),
        onPause: vi.fn(async () => {}),
        onResume: vi.fn(async () => {}),
        onDelete: vi.fn(async () => {}),
        onEdit: vi.fn(),
        taskCounts: {
          leased: 0,
          running: 0,
          paused: 1,
          completed: 0,
          failed: 0,
          cancelled: 0,
        },
        taskList: [
          {
            task_id: "550e8400-e29b-41d4-a716-446655440002",
            status: "paused",
            last_event_at: "2026-03-21T12:05:00.000Z",
            pause_detail: "Awaiting operator review.",
          },
        ],
        approvalBlockers: [],
        decisions: [],
        artifacts: [],
        signals: [],
        agentKvEntries: [],
        workItemKvEntries: [],
      }),
    );

    expect(markup).toContain("detail Awaiting operator review.");
  });

  it("shows approval blockers by default when blockers exist", () => {
    const markup = renderToStaticMarkup(
      React.createElement(WorkBoardDrilldown, {
        selectedWorkItemId: "550e8400-e29b-41d4-a716-446655440001",
        drilldownBusy: false,
        drilldownError: null,
        selectedItem: {
          work_item_id: "550e8400-e29b-41d4-a716-446655440001",
          tenant_id: "tenant-test",
          agent_id: "00000000-0000-4000-8000-000000000001",
          workspace_id: "workspace-test",
          kind: "action",
          title: "Review blocked work item",
          status: "blocked",
          priority: 1,
          created_at: "2026-03-21T12:00:00.000Z",
          created_from_session_key: "session.test",
          last_active_at: null,
        },
        pendingAction: null,
        canMarkReadySelected: false,
        canPauseSelected: false,
        canResumeSelected: false,
        canEditSelected: false,
        canDeleteSelected: false,
        canCancelSelected: false,
        isReadOnlyLocked: false,
        onTransition: vi.fn(async () => {}),
        onPause: vi.fn(async () => {}),
        onResume: vi.fn(async () => {}),
        onDelete: vi.fn(async () => {}),
        onEdit: vi.fn(),
        taskCounts: {
          leased: 0,
          running: 0,
          paused: 0,
          completed: 0,
          failed: 0,
          cancelled: 0,
        },
        taskList: [],
        approvalBlockers: [
          {
            task_id: "550e8400-e29b-41d4-a716-446655440003",
            status: "paused",
            last_event_at: "2026-03-21T12:05:00.000Z",
            approval_id: "550e8400-e29b-41d4-a716-446655440004",
          },
        ],
        decisions: [],
        artifacts: [],
        signals: [],
        agentKvEntries: [],
        workItemKvEntries: [],
      }),
    );

    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("Blocked by approval");
  });

  it("applies shared markdown prose classes for GFM tables in drilldown content", () => {
    const testRoot = renderIntoDocument(
      React.createElement(WorkBoardDrilldown, {
        selectedWorkItemId: "550e8400-e29b-41d4-a716-446655440001",
        drilldownBusy: false,
        drilldownError: null,
        selectedItem: {
          work_item_id: "550e8400-e29b-41d4-a716-446655440001",
          tenant_id: "tenant-test",
          agent_id: "00000000-0000-4000-8000-000000000001",
          workspace_id: "workspace-test",
          kind: "action",
          title: "Review markdown rendering",
          status: "doing",
          priority: 1,
          created_at: "2026-03-21T12:00:00.000Z",
          created_from_session_key: "session.test",
          last_active_at: null,
        },
        pendingAction: null,
        canMarkReadySelected: false,
        canPauseSelected: false,
        canResumeSelected: false,
        canEditSelected: false,
        canDeleteSelected: false,
        canCancelSelected: false,
        isReadOnlyLocked: false,
        onTransition: vi.fn(async () => {}),
        onPause: vi.fn(async () => {}),
        onResume: vi.fn(async () => {}),
        onDelete: vi.fn(async () => {}),
        onEdit: vi.fn(),
        taskCounts: {
          leased: 0,
          running: 1,
          paused: 0,
          completed: 0,
          failed: 0,
          cancelled: 0,
        },
        taskList: [],
        approvalBlockers: [],
        decisions: [
          {
            decision_id: "550e8400-e29b-41d4-a716-446655440010",
            work_item_id: "550e8400-e29b-41d4-a716-446655440001",
            question: "Which option should we pick?",
            chosen: "Option A",
            rationale_md:
              "| Option | Status |\n| --- | --- |\n| A | chosen |\n\n- keep table text readable",
            created_at: "2026-03-21T12:10:00.000Z",
          },
        ],
        artifacts: [],
        signals: [],
        agentKvEntries: [],
        workItemKvEntries: [],
      }),
    );

    const decisionsToggle = Array.from(testRoot.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Decisions",
    );
    expect(decisionsToggle).toBeInstanceOf(HTMLButtonElement);

    act(() => {
      click(decisionsToggle as HTMLButtonElement);
    });

    const proseBlock = testRoot.container.querySelector("div.prose");
    expect(proseBlock).not.toBeNull();
    expect(proseBlock?.className).toContain("!text-xs");
    expect(proseBlock?.className).toContain("prose-bullets:text-fg-muted");
    expect(proseBlock?.className).toContain("prose-counters:text-fg-muted");
    expect(proseBlock?.className).toContain("prose-th:text-fg");
    expect(proseBlock?.className).toContain("prose-td:text-fg");
    expect(testRoot.container.querySelector("table")).not.toBeNull();

    cleanupTestRoot(testRoot);
  });
});
