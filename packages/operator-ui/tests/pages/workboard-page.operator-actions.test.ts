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
import {
  click,
  cleanupTestRoot,
  renderIntoDocument,
  setStructuredJsonObjectField,
  stubMatchMedia,
} from "../test-utils.js";

function setInputValue(container: ParentNode, testId: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  expect(input).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  expect(setValue).toBeTypeOf("function");
  setValue!.call(input, value);
  input!.dispatchEvent(new Event("input", { bubbles: true }));
  input!.dispatchEvent(new Event("change", { bubbles: true }));
}

function findButton(container: ParentNode, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (el) => el.textContent?.trim() === label,
  );
  expect(button).not.toBeNull();
  return button!;
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
            acceptance: work_item_id === "wi-created" ? { done: true } : undefined,
            fingerprint:
              work_item_id === "wi-created" ? { resources: ["workspace://repo/main"] } : undefined,
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
      });
      await setStructuredJsonObjectField(createDialog!, "workboard-editor-acceptance", {
        key: "done",
        kind: "boolean",
        value: true,
      });
      await act(async () => {
        click(findButton(createDialog!, "Add resource"));
        await Promise.resolve();
      });
      act(() => {
        setInputValue(
          createDialog!,
          "structured-json-schema-field-root-resources-0",
          "workspace://repo/main",
        );
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
          fingerprint: { resources: ["workspace://repo/main"] },
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
          fingerprint: { resources: ["workspace://repo/main"] },
          budgets: undefined,
        },
      });
      await flushEffects();
      expect(testRoot.container.textContent).toContain("Edited from operator");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("shows leased controls, keeps edit disabled, and allows pause and resume", async () => {
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
      expect(testRoot.container.textContent).toContain(
        "Edit stays disabled while leased, but you can pause, cancel, or delete to stop the active agent work.",
      );
      expect(findButton(testRoot.container, "Edit").disabled).toBe(true);
      expect(findButton(testRoot.container, "Delete").disabled).toBe(false);
      expect(findButton(testRoot.container, "Cancel").disabled).toBe(false);

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
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("deletes leased work directly from the operator UI", async () => {
    const workItem = makeWorkItem({ work_item_id: "wi-delete", status: "doing" });
    const { core, ws } = createCore(
      "connected",
      {
        workGet: vi.fn(async () => ({ item: workItem })),
        workArtifactList: vi.fn(async () => ({ artifacts: [] })),
        workDecisionList: vi.fn(async () => ({ decisions: [] })),
        workSignalList: vi.fn(async () => ({ signals: [] })),
        workStateKvList: vi.fn(async () => ({ entries: [] })),
        workDelete: vi.fn(async ({ work_item_id }: any) => ({
          item: makeWorkItem({ work_item_id, status: "doing" }),
        })),
      },
      {
        items: [workItem],
        supported: true,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        tasksByWorkItemId: {
          "wi-delete": {
            "task-1": {
              task_id: "task-1",
              status: "leased",
              last_event_at: "2026-01-01T00:01:00.000Z",
            },
          },
        },
      },
    );

    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));
    try {
      await flushEffects();

      await act(async () => {
        click(
          testRoot.container.querySelector<HTMLElement>('[data-testid="work-item-wi-delete"]')!,
        );
        await Promise.resolve();
      });

      expect(findButton(testRoot.container, "Delete").disabled).toBe(false);

      await act(async () => {
        click(findButton(testRoot.container, "Delete"));
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
        work_item_id: "wi-delete",
      });
      expect(testRoot.container.textContent).not.toContain("wi-delete");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("cancels leased work directly from the operator UI", async () => {
    const workItem = makeWorkItem({ work_item_id: "wi-cancel", status: "doing" });
    const { core, ws } = createCore(
      "connected",
      {
        workGet: vi.fn(async () => ({ item: workItem })),
        workArtifactList: vi.fn(async () => ({ artifacts: [] })),
        workDecisionList: vi.fn(async () => ({ decisions: [] })),
        workSignalList: vi.fn(async () => ({ signals: [] })),
        workStateKvList: vi.fn(async () => ({ entries: [] })),
        workTransition: vi.fn(async ({ work_item_id, status }: any) => ({
          item: makeWorkItem({ work_item_id, status }),
        })),
      },
      {
        items: [workItem],
        supported: true,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        tasksByWorkItemId: {
          "wi-cancel": {
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

      await act(async () => {
        click(
          testRoot.container.querySelector<HTMLElement>('[data-testid="work-item-wi-cancel"]')!,
        );
        await Promise.resolve();
      });

      expect(findButton(testRoot.container, "Cancel").disabled).toBe(false);

      await act(async () => {
        click(findButton(testRoot.container, "Cancel"));
        await Promise.resolve();
      });
      await flushEffects();
      const dialog = document.querySelector<HTMLElement>('[data-testid="confirm-danger-dialog"]');
      expect(dialog).not.toBeNull();
      const checkbox = dialog!.querySelector<HTMLElement>(
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

      expect(ws.workTransition).toHaveBeenCalledWith({
        ...DEFAULT_SCOPE_KEYS,
        work_item_id: "wi-cancel",
        status: "cancelled",
        reason: "operator cancelled",
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("does not offer cancel for backlog work even when a lease is active", async () => {
    const workItem = makeWorkItem({ work_item_id: "wi-backlog", status: "backlog" });
    const { core } = createCore(
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
        supported: true,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        tasksByWorkItemId: {
          "wi-backlog": {
            "task-1": {
              task_id: "task-1",
              status: "leased",
              last_event_at: "2026-01-01T00:01:00.000Z",
            },
          },
        },
      },
    );

    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));
    try {
      await flushEffects();

      await act(async () => {
        click(
          testRoot.container.querySelector<HTMLElement>('[data-testid="work-item-wi-backlog"]')!,
        );
        await Promise.resolve();
      });

      const cancelButton = Array.from(
        testRoot.container.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === "Cancel");
      expect(cancelButton).toBeUndefined();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
