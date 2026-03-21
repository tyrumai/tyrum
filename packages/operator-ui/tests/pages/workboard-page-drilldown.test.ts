// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkBoardDrilldown } from "../../src/components/pages/workboard-page-drilldown.js";

describe("WorkBoardDrilldown", () => {
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
});
