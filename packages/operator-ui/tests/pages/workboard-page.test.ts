// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { WorkBoardPage } from "../../src/components/pages/workboard-page.js";
import { WORK_ITEM_STATUSES } from "../../src/components/workboard/workboard-store.js";
import {
  DEFAULT_SCOPE_KEYS,
  clickButton,
  createCore,
  expectDefaultScopeCall,
  expectStateScopeGetCall,
  expectStateScopeListCall,
  flushEffects,
  getStatusColumn,
  makeWorkItem,
} from "./workboard-page.test-support.js";
import { cleanupTestRoot, renderIntoDocument, stubMatchMedia } from "../test-utils.js";

describe("WorkBoardPage", () => {
  it("shows disconnected state and reconnects", () => {
    const { core } = createCore("disconnected");
    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));

    try {
      expect(testRoot.container.textContent).toContain("Not connected");

      act(() => {
        clickButton(testRoot.container, "Reconnect");
      });

      expect(core.disconnect).toHaveBeenCalledTimes(1);
      expect(core.connect).toHaveBeenCalledTimes(1);
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("uses a status selector on narrow screens without horizontal board scrolling", () => {
    const { core } = createCore("connected");
    const matchMedia = stubMatchMedia("(min-width: 1024px)", false);
    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));

    try {
      const selector = testRoot.container.querySelector(
        '[data-testid="workboard-status-selector"]',
      );
      const board = testRoot.container.querySelector<HTMLElement>(
        '[data-testid="workboard-board"]',
      );
      expect(selector).not.toBeNull();
      expect(board).toBeNull();
      expect(testRoot.container.textContent).toContain("Backlog");
    } finally {
      matchMedia.cleanup();
      cleanupTestRoot(testRoot);
    }
  });

  it("renders an aligned board header on large screens", () => {
    const { core } = createCore("connected");
    const matchMedia = stubMatchMedia("(min-width: 1024px)", true);
    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));

    try {
      const board = testRoot.container.querySelector<HTMLElement>(
        '[data-testid="workboard-board"]',
      );
      const boardHeader = testRoot.container.querySelector<HTMLElement>(
        '[data-testid="workboard-board-header"]',
      );
      expect(board).not.toBeNull();
      expect(boardHeader).not.toBeNull();
      expect(boardHeader?.style.gridTemplateColumns).toBe(
        `repeat(${WORK_ITEM_STATUSES.length}, minmax(0, 1fr))`,
      );
    } finally {
      matchMedia.cleanup();
      cleanupTestRoot(testRoot);
    }
  });

  it("loads work items, drills down, processes events, and transitions selected item", async () => {
    const workItem = makeWorkItem({ work_item_id: "wi-1", status: "backlog" });
    const { core, ws, workboard } = createCore(
      "connected",
      {
        workGet: vi.fn(async () => ({ item: workItem })),
        workArtifactList: vi.fn(async () => ({
          artifacts: [
            {
              artifact_id: "artifact-1",
              work_item_id: "wi-1",
              kind: "note",
              title: "Artifact title",
              body_md: "Artifact body",
              refs: [],
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        })),
        workDecisionList: vi.fn(async () => ({
          decisions: [
            {
              decision_id: "decision-1",
              work_item_id: "wi-1",
              question: "Ship?",
              chosen: "yes",
              rationale_md: "Looks good",
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        })),
        workSignalList: vi.fn(async () => ({
          signals: [
            {
              signal_id: "signal-1",
              work_item_id: "wi-1",
              trigger_kind: "manual",
              status: "pending",
              trigger_spec_json: { source: "manual" },
              created_at: "2026-01-01T00:00:00.000Z",
              last_fired_at: null,
            },
          ],
        })),
        workStateKvList: vi.fn(async ({ scope }: any) => {
          if (scope.kind === "agent") {
            return {
              entries: [
                {
                  scope,
                  key: "agent.key",
                  value_json: { value: "agent" },
                },
              ],
            };
          }
          return {
            entries: [
              {
                scope,
                key: "work.key",
                value_json: { value: "work-item" },
              },
            ],
          };
        }),
        workTransition: vi.fn(async ({ work_item_id, status }: any) => ({
          item: makeWorkItem({ work_item_id, status }),
        })),
      },
      {
        items: [workItem],
        supported: true,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      },
    );

    const matchMedia = stubMatchMedia("(min-width: 1024px)", true);
    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));
    try {
      await flushEffects();
      expect(testRoot.container.textContent).toContain("Ship regression tests");

      const workItemCard = Array.from(
        testRoot.container.querySelectorAll<HTMLButtonElement>('button[data-testid^="work-item-"]'),
      ).find((el) => el.textContent?.includes("Ship regression tests"));
      expect(workItemCard).not.toBeUndefined();

      await act(async () => {
        workItemCard?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(ws.workGet).toHaveBeenCalledTimes(1);
      expectDefaultScopeCall(ws.workGet, { work_item_id: "wi-1" });
      expectDefaultScopeCall(ws.workArtifactList, { work_item_id: "wi-1", limit: 200 });
      expectDefaultScopeCall(ws.workDecisionList, { work_item_id: "wi-1", limit: 200 });
      expectDefaultScopeCall(ws.workSignalList, { work_item_id: "wi-1", limit: 200 });
      expectStateScopeListCall(ws.workStateKvList, 1, { kind: "agent", ...DEFAULT_SCOPE_KEYS });
      expectStateScopeListCall(ws.workStateKvList, 2, {
        kind: "work_item",
        ...DEFAULT_SCOPE_KEYS,
        work_item_id: "wi-1",
      });
      expect(testRoot.container.textContent).toContain("Artifact title");
      expect(testRoot.container.textContent).toContain("Looks good");

      await act(async () => {
        clickButton(testRoot.container, "Mark Ready");
        await Promise.resolve();
      });
      expectDefaultScopeCall(ws.workTransition, {
        work_item_id: "wi-1",
        status: "ready",
        reason: "operator triaged",
      });
      await flushEffects();
      const backlogColumn = getStatusColumn(testRoot.container, "Backlog");
      const readyColumn = getStatusColumn(testRoot.container, "Ready");
      expect(backlogColumn.textContent).toContain("No items");
      expect(readyColumn.textContent).toContain("Ship regression tests");

      vi.stubGlobal(
        "confirm",
        vi.fn(() => false),
      );
      await act(async () => {
        clickButton(testRoot.container, "Cancel");
        await Promise.resolve();
      });
      expect(ws.workTransition).toHaveBeenCalledTimes(1);

      vi.stubGlobal(
        "confirm",
        vi.fn(() => true),
      );
      await act(async () => {
        clickButton(testRoot.container, "Cancel");
        await Promise.resolve();
      });
      expect(ws.workTransition).toHaveBeenCalledTimes(2);

      act(() => {
        workboard.setState((prev) => ({
          ...prev,
          tasksByWorkItemId: {
            ...prev.tasksByWorkItemId,
            "wi-1": {
              ...prev.tasksByWorkItemId["wi-1"],
              "task-1": {
                task_id: "task-1",
                status: "paused",
                last_event_at: "2026-01-01T00:01:00.000Z",
                approval_id: 42,
              },
            },
          },
        }));
      });
      await flushEffects();
      expect(testRoot.container.textContent).toContain("approval 42");

      act(() => {
        ws.emit("work.artifact.created", {
          payload: {
            artifact: {
              artifact_id: "artifact-2",
              work_item_id: "wi-1",
              kind: "note",
              title: "Live artifact",
              body_md: "Created by event",
              refs: [],
              created_at: "2026-01-01T00:02:00.000Z",
            },
          },
        });
        ws.emit("work.decision.created", {
          payload: {
            decision: {
              decision_id: "decision-2",
              work_item_id: "wi-1",
              question: "Proceed?",
              chosen: "yes",
              rationale_md: "Event decision",
              created_at: "2026-01-01T00:02:00.000Z",
            },
          },
        });
        ws.emit("work.signal.updated", {
          payload: {
            signal: {
              signal_id: "signal-2",
              work_item_id: "wi-1",
              trigger_kind: "manual",
              status: "pending",
              trigger_spec_json: { source: "event" },
              created_at: "2026-01-01T00:02:00.000Z",
              last_fired_at: null,
            },
          },
        });
      });
      await flushEffects();
      expect(testRoot.container.textContent).toContain("Live artifact");
      expect(testRoot.container.textContent).toContain("Event decision");

      act(() => {
        ws.emit("work.signal.fired", { payload: { signal_id: "signal-fired-1" } });
        ws.emit("work.state_kv.updated", {
          payload: {
            scope: {
              kind: "agent",
              agent_key: "default",
              workspace_key: "default",
            },
            key: "agent.from-event",
          },
        });
        ws.emit("work.state_kv.updated", {
          payload: {
            scope: {
              kind: "work_item",
              agent_key: "default",
              workspace_key: "default",
              work_item_id: "wi-1",
            },
            key: "work.from-event",
          },
        });
      });
      await flushEffects();
      expect(ws.workSignalGet).toHaveBeenCalledTimes(1);
      expectDefaultScopeCall(ws.workSignalGet, { signal_id: "signal-fired-1" });
      expect(ws.workStateKvGet).toHaveBeenCalledTimes(2);
      expectStateScopeGetCall(
        ws.workStateKvGet,
        1,
        { kind: "agent", ...DEFAULT_SCOPE_KEYS },
        "agent.from-event",
      );
      expectStateScopeGetCall(
        ws.workStateKvGet,
        2,
        { kind: "work_item", ...DEFAULT_SCOPE_KEYS, work_item_id: "wi-1" },
        "work.from-event",
      );
      expect(testRoot.container.textContent).toContain("agent.from-event");
      expect(testRoot.container.textContent).toContain("work.from-event");

      act(() => {
        clickButton(testRoot.container, "Reconnect");
      });
      expect(core.disconnect).toHaveBeenCalledTimes(1);
      expect(core.connect).toHaveBeenCalledTimes(1);
    } finally {
      matchMedia.cleanup();
      cleanupTestRoot(testRoot);
    }
  });

  it("shows unsupported-request message when work.list is not available", async () => {
    const { core } = createCore("connected", undefined, {
      supported: false,
      error: "WorkBoard is not supported by this gateway (database not configured).",
    });

    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));
    try {
      await flushEffects();
      expect(testRoot.container.textContent).toContain(
        "WorkBoard is not supported by this gateway (database not configured).",
      );
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
