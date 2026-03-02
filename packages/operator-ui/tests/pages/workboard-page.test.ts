// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { WorkBoardPage } from "../../src/components/pages/workboard-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

function createConnectionStore(status: ConnectionStatus) {
  const snapshot = { status, recovering: false };
  return {
    subscribe: (_listener: () => void) => () => {},
    getSnapshot: () => snapshot,
  };
}

function createWsStub(overrides?: Partial<Record<string, unknown>>) {
  const handlers = new Map<string, Set<(event: any) => void>>();

  const ws = {
    on: vi.fn((event: string, handler: (payload: any) => void) => {
      const existing = handlers.get(event) ?? new Set();
      existing.add(handler);
      handlers.set(event, existing);
    }),
    off: vi.fn((event: string, handler: (payload: any) => void) => {
      const existing = handlers.get(event);
      if (!existing) return;
      existing.delete(handler);
      if (existing.size === 0) handlers.delete(event);
    }),
    emit(event: string, payload: any) {
      for (const handler of handlers.get(event) ?? []) {
        handler(payload);
      }
    },
    workList: vi.fn(async () => ({ items: [] })),
    workTransition: vi.fn(async ({ work_item_id, status }: any) => ({
      item: makeWorkItem({ work_item_id, status }),
    })),
    workGet: vi.fn(async ({ work_item_id }: any) => ({ item: makeWorkItem({ work_item_id }) })),
    workArtifactList: vi.fn(async () => ({ artifacts: [] })),
    workDecisionList: vi.fn(async () => ({ decisions: [] })),
    workSignalList: vi.fn(async () => ({ signals: [] })),
    workStateKvList: vi.fn(async () => ({ entries: [] })),
    workSignalGet: vi.fn(async ({ signal_id }: any) => ({
      signal: {
        signal_id,
        work_item_id: "wi-1",
        trigger_kind: "manual",
        status: "fired",
        created_at: "2026-01-01T00:00:00.000Z",
        last_fired_at: "2026-01-01T00:00:01.000Z",
        trigger_spec_json: { source: "event" },
      },
    })),
    workStateKvGet: vi.fn(async ({ key, scope }: any) => ({
      entry: {
        scope,
        key,
        value_json: { value: key },
      },
    })),
    ...overrides,
  };

  return ws;
}

function makeWorkItem(partial: Partial<Record<string, unknown>> & { work_item_id: string }) {
  return {
    work_item_id: partial.work_item_id,
    title: "Ship regression tests",
    kind: "task",
    priority: 2,
    status: "backlog",
    acceptance: { done: true },
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:05:00.000Z",
    last_active_at: "2026-01-01T00:10:00.000Z",
    ...partial,
  } as any;
}

function createCore(status: ConnectionStatus, wsOverrides?: Partial<Record<string, unknown>>) {
  const ws = createWsStub(wsOverrides);
  const core = {
    connectionStore: createConnectionStore(status),
    ws,
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as OperatorCore;
  return { core, ws };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function clickButton(container: HTMLElement, label: string): void {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((el) =>
    el.textContent?.includes(label),
  );
  expect(button).not.toBeUndefined();
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("WorkBoardPage", () => {
  it("shows disconnected state and reconnects", () => {
    const { core } = createCore("disconnected");
    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));

    try {
      expect(testRoot.container.textContent).toContain("Not connected");
      const refreshButton = Array.from(
        testRoot.container.querySelectorAll<HTMLButtonElement>("button"),
      ).find((el) => el.textContent?.includes("Refresh"));
      expect(refreshButton?.disabled).toBe(true);

      act(() => {
        clickButton(testRoot.container, "Reconnect");
      });

      expect(core.disconnect).toHaveBeenCalledTimes(1);
      expect(core.connect).toHaveBeenCalledTimes(1);
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("loads work items, drills down, processes events, and transitions selected item", async () => {
    const workItem = makeWorkItem({ work_item_id: "wi-1", status: "backlog" });
    const { core, ws } = createCore("connected", {
      workList: vi.fn(async () => ({ items: [workItem] })),
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
    });

    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));
    try {
      await flushEffects();
      expect(ws.workList).toHaveBeenCalledTimes(1);
      expect(testRoot.container.textContent).toContain("Ship regression tests");

      const workItemCard = Array.from(
        testRoot.container.querySelectorAll<HTMLElement>('[role="button"]'),
      ).find((el) => el.textContent?.includes("Ship regression tests"));
      expect(workItemCard).not.toBeUndefined();

      await act(async () => {
        workItemCard?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(ws.workGet).toHaveBeenCalledTimes(1);
      expect(testRoot.container.textContent).toContain("Artifact title");
      expect(testRoot.container.textContent).toContain("Looks good");

      await act(async () => {
        clickButton(testRoot.container, "Mark Ready");
        await Promise.resolve();
      });
      expect(ws.workTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          work_item_id: "wi-1",
          status: "ready",
          reason: "operator triaged",
        }),
      );

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
        ws.emit("work.task.paused", {
          type: "work.task.paused",
          occurred_at: "2026-01-01T00:01:00.000Z",
          payload: {
            work_item_id: "wi-1",
            task_id: "task-1",
            approval_id: 42,
          },
        });
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
              tenant_id: "default",
              agent_id: "default",
              workspace_id: "default",
            },
            key: "agent.from-event",
          },
        });
        ws.emit("work.state_kv.updated", {
          payload: {
            scope: {
              kind: "work_item",
              tenant_id: "default",
              agent_id: "default",
              workspace_id: "default",
              work_item_id: "wi-1",
            },
            key: "work.from-event",
          },
        });
      });
      await flushEffects();
      expect(ws.workSignalGet).toHaveBeenCalledTimes(1);
      expect(ws.workStateKvGet).toHaveBeenCalledTimes(2);
      expect(testRoot.container.textContent).toContain("agent.from-event");
      expect(testRoot.container.textContent).toContain("work.from-event");

      await act(async () => {
        clickButton(testRoot.container, "Refresh");
        await Promise.resolve();
      });
      expect(ws.workList).toHaveBeenCalledTimes(2);

      act(() => {
        clickButton(testRoot.container, "Reconnect");
      });
      expect(core.disconnect).toHaveBeenCalledTimes(1);
      expect(core.connect).toHaveBeenCalledTimes(1);
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("shows unsupported-request message when work.list is not available", async () => {
    const { core } = createCore("connected", {
      workList: vi.fn(async () => {
        throw new Error("work.list failed: unsupported_request");
      }),
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
