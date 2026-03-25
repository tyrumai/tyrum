// @vitest-environment jsdom

import { act } from "react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { WorkBoardPage } from "../../src/components/pages/workboard-page.js";
import {
  DEFAULT_SCOPE_KEYS,
  clickButton,
  createCore,
  flushEffects,
  makeWorkItem,
} from "./workboard-page.test-support.js";
import { cleanupTestRoot, renderIntoDocument, stubMatchMedia } from "../test-utils.js";

async function selectWorkItem(container: HTMLElement, title: string): Promise<void> {
  const workItemCard = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button[data-testid^="work-item-"]'),
  ).find((element) => element.textContent?.includes(title));
  expect(workItemCard).not.toBeUndefined();

  await act(async () => {
    workItemCard?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("WorkBoardPage live update recovery", () => {
  it("resyncs signals when the live signal fetch fails", async () => {
    const workItem = makeWorkItem({ work_item_id: "wi-1" });
    const { core, ws } = createCore(
      "connected",
      {
        workGet: vi.fn(async () => ({ item: workItem })),
        workArtifactList: vi.fn(async () => ({ artifacts: [] })),
        workDecisionList: vi.fn(async () => ({ decisions: [] })),
        workSignalList: vi
          .fn()
          .mockResolvedValueOnce({
            signals: [
              {
                signal_id: "signal-1",
                work_item_id: "wi-1",
                trigger_kind: "manual",
                status: "pending",
                trigger_spec_json: { source: "initial" },
                created_at: "2026-01-01T00:00:00.000Z",
                last_fired_at: null,
              },
            ],
          })
          .mockResolvedValueOnce({
            signals: [
              {
                signal_id: "signal-fired-1",
                work_item_id: "wi-1",
                trigger_kind: "manual",
                status: "fired",
                trigger_spec_json: { source: "resync" },
                created_at: "2026-01-01T00:00:00.000Z",
                last_fired_at: "2026-01-01T00:01:00.000Z",
              },
            ],
          }),
        workSignalGet: vi.fn(async () => {
          throw new Error("signal fetch failed");
        }),
        workStateKvList: vi.fn(async () => ({ entries: [] })),
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
      await selectWorkItem(testRoot.container, "Ship regression tests");

      act(() => {
        ws.emit("work.signal.fired", { payload: { signal_id: "signal-fired-1" } });
      });
      await flushEffects();

      expect(ws.workSignalGet).toHaveBeenCalledWith({
        ...DEFAULT_SCOPE_KEYS,
        signal_id: "signal-fired-1",
      });
      expect(ws.workSignalList).toHaveBeenNthCalledWith(2, {
        ...DEFAULT_SCOPE_KEYS,
        work_item_id: "wi-1",
        limit: 200,
      });

      act(() => {
        clickButton(testRoot.container, "Signals");
      });
      expect(testRoot.container.textContent).toContain("status fired");
      expect(testRoot.container.textContent).not.toContain("Item details error");
    } finally {
      matchMedia.cleanup();
      cleanupTestRoot(testRoot);
    }
  });

  it("resyncs work-item state when the live KV fetch fails", async () => {
    const workItem = makeWorkItem({ work_item_id: "wi-1" });
    const { core, ws } = createCore(
      "connected",
      {
        workGet: vi.fn(async () => ({ item: workItem })),
        workArtifactList: vi.fn(async () => ({ artifacts: [] })),
        workDecisionList: vi.fn(async () => ({ decisions: [] })),
        workSignalList: vi.fn(async () => ({ signals: [] })),
        workStateKvList: vi
          .fn()
          .mockResolvedValueOnce({ entries: [] })
          .mockResolvedValueOnce({ entries: [] })
          .mockResolvedValueOnce({
            entries: [
              {
                scope: {
                  kind: "work_item",
                  ...DEFAULT_SCOPE_KEYS,
                  work_item_id: "wi-1",
                },
                key: "work.from-event",
                value_json: { value: "resynced" },
              },
            ],
          }),
        workStateKvGet: vi.fn(async () => {
          throw new Error("kv fetch failed");
        }),
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
      await selectWorkItem(testRoot.container, "Ship regression tests");

      act(() => {
        ws.emit("work.state_kv.updated", {
          payload: {
            scope: {
              kind: "work_item",
              ...DEFAULT_SCOPE_KEYS,
              work_item_id: "wi-1",
            },
            key: "work.from-event",
          },
        });
      });
      await flushEffects();

      expect(ws.workStateKvGet).toHaveBeenCalledWith({
        scope: {
          kind: "work_item",
          ...DEFAULT_SCOPE_KEYS,
          work_item_id: "wi-1",
        },
        key: "work.from-event",
      });
      expect(ws.workStateKvList).toHaveBeenNthCalledWith(3, {
        scope: {
          kind: "work_item",
          ...DEFAULT_SCOPE_KEYS,
          work_item_id: "wi-1",
        },
      });

      act(() => {
        clickButton(testRoot.container, "State KV (work item)");
      });
      expect(testRoot.container.textContent).toContain("work.from-event");
      expect(testRoot.container.textContent).toContain("resynced");
      expect(testRoot.container.textContent).not.toContain("Item details error");
    } finally {
      matchMedia.cleanup();
      cleanupTestRoot(testRoot);
    }
  });
});
