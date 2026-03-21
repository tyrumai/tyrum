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
import { click, cleanupTestRoot, renderIntoDocument, stubMatchMedia } from "../test-utils.js";

function setSelectValue(container: HTMLElement, testId: string, value: string): void {
  const select = container.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`);
  expect(select).not.toBeNull();
  select!.value = value;
  select!.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("WorkBoardPage", () => {
  it("uses global connection handling and keeps stale work visible while disconnected", async () => {
    const workItem = makeWorkItem({ work_item_id: "wi-stale" });
    const { core } = createCore("disconnected", undefined, {
      items: [workItem],
      supported: true,
      lastSyncedAt: "2026-01-01T00:00:00.000Z",
    });
    const matchMedia = stubMatchMedia("(min-width: 1160px)", true);
    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));

    try {
      await flushEffects();
      expect(testRoot.container.textContent).not.toContain("Not connected");
      expect(testRoot.container.textContent).toContain("Ship regression tests");
      expect(testRoot.container.textContent).not.toContain("Reconnect");
      expect(
        testRoot.container.querySelector('[data-testid="workboard-scope-workspace"]'),
      ).toBeNull();
    } finally {
      matchMedia.cleanup();
      cleanupTestRoot(testRoot);
    }
  });

  it("uses a status selector on narrow screens without horizontal board scrolling", () => {
    const { core } = createCore("connected");
    const matchMedia = stubMatchMedia("(min-width: 1160px)", false);
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
    const matchMedia = stubMatchMedia("(min-width: 1160px)", true);
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
      expect(boardHeader?.style.minWidth).toBe("1120px");
      expect(boardHeader?.nextElementSibling).not.toBeNull();
      expect((boardHeader?.nextElementSibling as HTMLElement | null)?.style.minWidth).toBe(
        "1120px",
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

    const matchMedia = stubMatchMedia("(min-width: 1160px)", true);
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
      // Artifacts and Decisions sections are collapsed by default; expand them.
      act(() => {
        clickButton(testRoot.container, "Artifacts");
        clickButton(testRoot.container, "Decisions");
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

      // Click Cancel to open ConfirmDangerDialog, then dismiss
      await act(async () => {
        clickButton(testRoot.container, "Cancel");
        await Promise.resolve();
      });
      // Dialog renders in a Radix Portal on document.body
      const dismissButton = document.querySelector<HTMLElement>(
        "[data-testid='confirm-danger-cancel']",
      );
      expect(dismissButton).not.toBeNull();
      await act(async () => {
        click(dismissButton!);
        await Promise.resolve();
      });
      expect(ws.workTransition).toHaveBeenCalledTimes(1);

      // Click Cancel again, check the confirmation checkbox, then confirm
      await act(async () => {
        clickButton(testRoot.container, "Cancel");
        await Promise.resolve();
      });
      const checkbox = document.querySelector<HTMLElement>(
        "[data-testid='confirm-danger-checkbox']",
      );
      expect(checkbox).not.toBeNull();
      await act(async () => {
        click(checkbox!);
        await Promise.resolve();
      });
      const confirmBtn = document.querySelector<HTMLElement>(
        "[data-testid='confirm-danger-confirm']",
      );
      expect(confirmBtn).not.toBeNull();
      await act(async () => {
        click(confirmBtn!);
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
                approval_id: "approval-42",
              },
            },
          },
        }));
      });
      await flushEffects();
      // The task appears in the Tasks section (open by default) with status "paused".
      // approval_id is no longer rendered as text; verify the task is visible.
      expect(testRoot.container.textContent).toContain("paused");

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
      // State KV sections are collapsed by default; expand them.
      act(() => {
        clickButton(testRoot.container, "State KV (agent)");
        clickButton(testRoot.container, "State KV (work item)");
      });
      expect(testRoot.container.textContent).toContain("agent.from-event");
      expect(testRoot.container.textContent).toContain("work.from-event");
      expect(testRoot.container.textContent).not.toContain("Reconnect");
    } finally {
      matchMedia.cleanup();
      cleanupTestRoot(testRoot);
    }
  });

  it("shows agent names without keys and preserves the active workspace when applying scope", async () => {
    const { core, http, workboard } = createCore("connected");
    http.agents.list.mockResolvedValueOnce({
      agents: [
        { agent_key: "builder", persona: { name: "" } },
        { agent_key: "default", persona: { name: "Default Agent" } },
      ],
    });

    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));
    try {
      await flushEffects();

      const agentSelect = testRoot.container.querySelector<HTMLSelectElement>(
        '[data-testid="workboard-scope-agent"]',
      );
      expect(agentSelect).not.toBeNull();
      expect(Array.from(agentSelect!.options).map((option) => option.text)).toEqual([
        "builder",
        "Default Agent",
      ]);
      expect(testRoot.container.textContent).not.toContain("default · Default Agent");

      act(() => {
        setSelectValue(testRoot.container, "workboard-scope-agent", "builder");
      });
      await act(async () => {
        clickButton(testRoot.container, "Load scope");
        await Promise.resolve();
      });

      expect(workboard.store.setScopeKeys).toHaveBeenLastCalledWith({
        agent_key: "builder",
        workspace_key: DEFAULT_SCOPE_KEYS.workspace_key,
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("preserves the current hidden workspace scope until the user changes it", async () => {
    const workItem = makeWorkItem({ work_item_id: "wi-scope" });
    const { core, ws, workboard } = createCore(
      "connected",
      {
        workGet: vi.fn(async () => ({ item: workItem })),
        workArtifactList: vi.fn(async () => ({ artifacts: [] })),
        workDecisionList: vi.fn(async () => ({ decisions: [] })),
        workSignalList: vi.fn(async () => ({ signals: [] })),
        workStateKvList: vi.fn(async () => ({ entries: [] })),
      },
      {
        items: [workItem],
        scopeKeys: { agent_key: "planner", workspace_key: "ops" },
        supported: true,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      },
    );
    workboard.store.refreshList = vi.fn(async () => {
      workboard.setState((prev) => ({
        ...prev,
        items: [workItem],
        supported: true,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      }));
    });

    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));
    try {
      await flushEffects();
      expect(workboard.store.setScopeKeys).not.toHaveBeenCalled();
      expect(workboard.store.refreshList).not.toHaveBeenCalled();

      const scopedCard = testRoot.container.querySelector<HTMLButtonElement>(
        '[data-testid="work-item-wi-scope"]',
      );
      expect(scopedCard).not.toBeNull();

      await act(async () => {
        scopedCard!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(ws.workGet).toHaveBeenCalledWith({
        agent_key: "planner",
        workspace_key: "ops",
        work_item_id: "wi-scope",
      });
      expect(ws.workArtifactList).toHaveBeenCalledWith({
        agent_key: "planner",
        workspace_key: "ops",
        work_item_id: "wi-scope",
        limit: 200,
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("omits empty scope keys when loading work state kv drilldown data", async () => {
    const workItem = makeWorkItem({ work_item_id: "wi-empty-scope" });
    const { core, ws } = createCore(
      "connected",
      {
        workGet: vi.fn(async () => ({ item: workItem })),
        workArtifactList: vi.fn(async () => ({ artifacts: [] })),
        workDecisionList: vi.fn(async () => ({ decisions: [] })),
        workSignalList: vi.fn(async () => ({ signals: [] })),
        workStateKvList: vi.fn(async () => ({ entries: [] })),
      },
      {
        items: [workItem],
        scopeKeys: { agent_key: "", workspace_key: "" },
        supported: true,
      },
    );

    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));
    try {
      await flushEffects();

      const scopedCard = testRoot.container.querySelector<HTMLButtonElement>(
        '[data-testid="work-item-wi-empty-scope"]',
      );
      expect(scopedCard).not.toBeNull();

      await act(async () => {
        scopedCard!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(ws.workGet).toHaveBeenCalledWith({ work_item_id: "wi-empty-scope" });
      expectStateScopeListCall(ws.workStateKvList, 1, { kind: "agent" });
      expectStateScopeListCall(ws.workStateKvList, 2, {
        kind: "work_item",
        work_item_id: "wi-empty-scope",
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
