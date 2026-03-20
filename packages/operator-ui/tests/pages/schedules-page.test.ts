// @vitest-environment jsdom

import type { OperatorCore } from "@tyrum/operator-app";
import type { ScheduleRecord } from "@tyrum/contracts";
import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchedulesPage } from "../../src/components/pages/schedules-page.js";
import { click, cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const mutationAccess = {
  canMutate: true,
  requestEnter: vi.fn(),
};

const schedulesApi = {
  list: vi.fn(),
  create: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  remove: vi.fn(),
};

vi.mock("../../src/components/pages/admin-http-shared.js", () => ({
  useAdminHttpClient: () => ({ schedules: schedulesApi }),
  useAdminMutationHttpClient: () => (mutationAccess.canMutate ? { schedules: schedulesApi } : null),
  useAdminMutationAccess: () => mutationAccess,
}));

function createSchedule(
  scheduleId: string,
  overrides: Partial<ScheduleRecord> = {},
): ScheduleRecord {
  return {
    schedule_id: scheduleId,
    watcher_key: `watcher-${scheduleId}`,
    kind: "heartbeat",
    enabled: true,
    cadence: { type: "interval", interval_ms: 60_000 },
    execution: { kind: "agent_turn" },
    delivery: { mode: "quiet" },
    seeded_default: false,
    deleted: false,
    target_scope: {
      agent_key: `agent-${scheduleId}`,
      workspace_key: `workspace-${scheduleId}`,
    },
    created_at: "2026-03-20T10:00:00.000Z",
    updated_at: "2026-03-20T10:00:00.000Z",
    last_fired_at: null,
    next_fire_at: null,
    ...overrides,
  };
}

function createCore(): OperatorCore {
  return {} as OperatorCore;
}

async function flushPage(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function clickAndFlush(element: HTMLElement): Promise<void> {
  await act(async () => {
    click(element);
    await Promise.resolve();
  });
}

function getByTestId<T extends HTMLElement>(root: ParentNode, testId: string): T {
  const element = root.querySelector<T>(`[data-testid="${testId}"]`);
  expect(element).not.toBeNull();
  return element!;
}

describe("SchedulesPage", () => {
  beforeEach(() => {
    mutationAccess.canMutate = true;
    mutationAccess.requestEnter.mockReset();
    schedulesApi.list.mockReset();
    schedulesApi.create.mockReset();
    schedulesApi.pause.mockReset();
    schedulesApi.resume.mockReset();
    schedulesApi.remove.mockReset();

    schedulesApi.list.mockResolvedValue({
      schedules: [
        createSchedule("alpha", { updated_at: "2026-03-20T10:00:00.000Z" }),
        createSchedule("beta", { updated_at: "2026-03-20T09:00:00.000Z" }),
      ],
    });
  });

  it("shows loading only on the schedule being paused even when another card is expanded", async () => {
    let resolvePause: ((value: { schedule: ScheduleRecord }) => void) | null = null;

    schedulesApi.pause.mockImplementation(
      async () =>
        await new Promise<{ schedule: ScheduleRecord }>((resolve) => {
          resolvePause = resolve;
        }),
    );

    const testRoot = renderIntoDocument(React.createElement(SchedulesPage, { core: createCore() }));
    try {
      await flushPage();

      await clickAndFlush(
        getByTestId<HTMLButtonElement>(testRoot.container, "schedule-details-beta"),
      );
      await clickAndFlush(
        getByTestId<HTMLButtonElement>(testRoot.container, "schedule-toggle-alpha"),
      );

      expect(
        getByTestId<HTMLButtonElement>(testRoot.container, "schedule-toggle-alpha").disabled,
      ).toBe(true);
      expect(
        getByTestId<HTMLButtonElement>(testRoot.container, "schedule-delete-alpha").disabled,
      ).toBe(true);
      expect(
        getByTestId<HTMLButtonElement>(testRoot.container, "schedule-toggle-beta").disabled,
      ).toBe(false);
      expect(
        getByTestId<HTMLButtonElement>(testRoot.container, "schedule-delete-beta").disabled,
      ).toBe(false);

      await act(async () => {
        resolvePause?.({
          schedule: createSchedule("alpha", {
            enabled: false,
            updated_at: "2026-03-20T11:00:00.000Z",
          }),
        });
        await Promise.resolve();
      });

      expect(
        getByTestId<HTMLButtonElement>(testRoot.container, "schedule-toggle-alpha").disabled,
      ).toBe(false);
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("renders a page alert when deleting a schedule fails", async () => {
    schedulesApi.remove.mockRejectedValueOnce(new Error("delete failed"));

    const testRoot = renderIntoDocument(React.createElement(SchedulesPage, { core: createCore() }));
    try {
      await flushPage();

      await clickAndFlush(
        getByTestId<HTMLButtonElement>(testRoot.container, "schedule-delete-alpha"),
      );
      await clickAndFlush(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
      await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));
      await flushPage();

      expect(testRoot.container.textContent).toContain("Schedule deletion failed");
      expect(testRoot.container.textContent).toContain("delete failed");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
