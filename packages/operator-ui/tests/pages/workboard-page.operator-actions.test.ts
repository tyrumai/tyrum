// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { WorkBoardPage } from "../../src/components/pages/workboard-page.js";
import {
  DEFAULT_SCOPE_KEYS,
  clickButton,
  createCore,
  flushEffects,
  makeWorkItem,
} from "./workboard-page.test-support.js";
import { click, cleanupTestRoot, renderIntoDocument, stubMatchMedia } from "../test-utils.js";

function setInputValue(container: ParentNode, testId: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  expect(input).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  expect(setValue).toBeTypeOf("function");
  setValue!.call(input, value);
  input!.dispatchEvent(new Event("input", { bubbles: true }));
  input!.dispatchEvent(new Event("change", { bubbles: true }));
}

function setTextareaValue(container: ParentNode, testId: string, value: string): void {
  const textarea = container.querySelector<HTMLTextAreaElement>(`[data-testid="${testId}"]`);
  expect(textarea).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  expect(setValue).toBeTypeOf("function");
  setValue!.call(textarea, value);
  textarea!.dispatchEvent(new Event("input", { bubbles: true }));
  textarea!.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("WorkBoardPage operator actions", () => {
  it("shows unsupported-request message when work.list is not available", async () => {
    const { core } = createCore("connected", undefined, {
      supported: false,
      error: "WorkBoard is not supported by this gateway (database not configured).",
    });

    const matchMedia = stubMatchMedia("(min-width: 1160px)", true);
    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));
    try {
      await flushEffects();
      expect(testRoot.container.textContent).toContain(
        "WorkBoard is not supported by this gateway (database not configured).",
      );
    } finally {
      matchMedia.cleanup();
      cleanupTestRoot(testRoot);
    }
  });

  it("creates and edits work items from the operator UI", async () => {
    const existing = makeWorkItem({ work_item_id: "wi-existing", status: "ready" });
    const { core, ws } = createCore(
      "connected",
      {
        workCreate: vi.fn(async ({ item }: any) => ({
          item: makeWorkItem({
            work_item_id: "wi-created",
            status: "backlog",
            ...item,
          }),
        })),
        workUpdate: vi.fn(async ({ work_item_id, patch }: any) => ({
          item: makeWorkItem({
            work_item_id,
            status: "backlog",
            ...patch,
          }),
        })),
        workGet: vi.fn(async ({ work_item_id }: any) => ({
          item: makeWorkItem({
            work_item_id,
            status: "backlog",
            title: work_item_id === "wi-created" ? "Created from operator" : existing.title,
          }),
        })),
        workArtifactList: vi.fn(async () => ({ artifacts: [] })),
        workDecisionList: vi.fn(async () => ({ decisions: [] })),
        workSignalList: vi.fn(async () => ({ signals: [] })),
        workStateKvList: vi.fn(async () => ({ entries: [] })),
      },
      {
        items: [existing],
        supported: true,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      },
    );

    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));
    try {
      await flushEffects();

      await act(async () => {
        clickButton(testRoot.container, "New work item");
        await Promise.resolve();
      });

      const createDialog = document.querySelector<HTMLElement>(
        '[data-testid="workboard-create-dialog"]',
      );
      expect(createDialog).not.toBeNull();
      act(() => {
        setInputValue(createDialog!, "workboard-editor-title", "Created from operator");
        setInputValue(createDialog!, "workboard-editor-priority", "3");
        setTextareaValue(createDialog!, "workboard-editor-acceptance", '{"done": true}');
      });
      await act(async () => {
        click(createDialog!.querySelector<HTMLElement>('[data-testid="workboard-editor-submit"]')!);
        await Promise.resolve();
      });

      expect(ws.workCreate).toHaveBeenCalledWith({
        ...DEFAULT_SCOPE_KEYS,
        item: {
          kind: "action",
          title: "Created from operator",
          priority: 3,
          acceptance: { done: true },
          fingerprint: undefined,
          budgets: undefined,
        },
      });

      await flushEffects();
      expect(testRoot.container.textContent).toContain("Created from operator");

      await act(async () => {
        clickButton(testRoot.container, "Edit");
        await Promise.resolve();
      });

      const editDialog = document.querySelector<HTMLElement>(
        '[data-testid="workboard-edit-dialog"]',
      );
      expect(editDialog).not.toBeNull();
      act(() => {
        setInputValue(editDialog!, "workboard-editor-title", "Edited from operator");
        setInputValue(editDialog!, "workboard-editor-priority", "4");
      });
      await act(async () => {
        click(editDialog!.querySelector<HTMLElement>('[data-testid="workboard-editor-submit"]')!);
        await Promise.resolve();
      });

      expect(ws.workUpdate).toHaveBeenCalledWith({
        ...DEFAULT_SCOPE_KEYS,
        work_item_id: "wi-created",
        patch: {
          title: "Edited from operator",
          priority: 4,
          acceptance: { done: true },
          fingerprint: undefined,
          budgets: undefined,
        },
      });
      await flushEffects();
      expect(testRoot.container.textContent).toContain("Edited from operator");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("shows a lease lock, pauses and resumes active work, and deletes after unlock", async () => {
    const workItem = makeWorkItem({ work_item_id: "wi-running", status: "doing" });
    const { core, ws, workboard } = createCore(
      "connected",
      {
        workGet: vi.fn(async () => ({ item: workItem })),
        workArtifactList: vi.fn(async () => ({ artifacts: [] })),
        workDecisionList: vi.fn(async () => ({ decisions: [] })),
        workSignalList: vi.fn(async () => ({ signals: [] })),
        workStateKvList: vi.fn(async () => ({ entries: [] })),
        workPause: vi.fn(async ({ work_item_id }: any) => ({
          item: makeWorkItem({ work_item_id, status: "blocked" }),
        })),
        workResume: vi.fn(async ({ work_item_id }: any) => ({
          item: makeWorkItem({ work_item_id, status: "ready" }),
        })),
        workDelete: vi.fn(async ({ work_item_id }: any) => ({
          item: makeWorkItem({ work_item_id, status: "ready" }),
        })),
      },
      {
        items: [workItem],
        supported: true,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        tasksByWorkItemId: {
          "wi-running": {
            "task-1": {
              task_id: "task-1",
              status: "running",
              last_event_at: "2026-01-01T00:01:00.000Z",
            },
          },
        },
      },
    );

    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));
    try {
      await flushEffects();

      const workItemCard = testRoot.container.querySelector<HTMLButtonElement>(
        '[data-testid="work-item-wi-running"]',
      );
      expect(workItemCard).not.toBeNull();
      await act(async () => {
        click(workItemCard!);
        await Promise.resolve();
      });

      expect(testRoot.container.textContent).toContain("Read-only while leased");

      await act(async () => {
        clickButton(testRoot.container, "Pause");
        await Promise.resolve();
      });
      expect(ws.workPause).toHaveBeenCalledWith({
        ...DEFAULT_SCOPE_KEYS,
        work_item_id: "wi-running",
        reason: "operator paused work item",
      });

      act(() => {
        workboard.setState((prev) => ({
          ...prev,
          tasksByWorkItemId: {
            ...prev.tasksByWorkItemId,
            "wi-running": {
              "task-1": {
                task_id: "task-1",
                status: "paused",
                last_event_at: "2026-01-01T00:02:00.000Z",
                pause_reason: "manual",
              },
            },
          },
        }));
      });
      await flushEffects();

      await act(async () => {
        clickButton(testRoot.container, "Resume");
        await Promise.resolve();
      });
      expect(ws.workResume).toHaveBeenCalledWith({
        ...DEFAULT_SCOPE_KEYS,
        work_item_id: "wi-running",
        reason: "operator resumed work item",
      });

      act(() => {
        workboard.setState((prev) => ({
          ...prev,
          tasksByWorkItemId: {},
        }));
      });
      await flushEffects();

      await act(async () => {
        clickButton(testRoot.container, "Delete");
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

      expect(ws.workDelete).toHaveBeenCalledWith({
        ...DEFAULT_SCOPE_KEYS,
        work_item_id: "wi-running",
      });
      expect(testRoot.container.textContent).not.toContain("wi-running");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
