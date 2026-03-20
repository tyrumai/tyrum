// @vitest-environment jsdom

import type { OperatorCore } from "@tyrum/operator-app";
import type { ScheduleRecord } from "@tyrum/contracts";
import React, { act } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchedulesPage } from "../../src/components/pages/schedules-page.js";
import { click, cleanupTestRoot, renderIntoDocument, setNativeValue } from "../test-utils.js";

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

function getButtonByText(root: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((element) =>
    element.textContent?.includes(text),
  );
  if (!button) {
    throw new Error(`Expected button containing "${text}"`);
  }
  return button;
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

  it("keeps the active schedule busy while another toggle is blocked", async () => {
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
        getByTestId<HTMLButtonElement>(testRoot.container, "schedule-toggle-alpha").getAttribute(
          "aria-busy",
        ),
      ).toBe("true");
      expect(
        getByTestId<HTMLButtonElement>(testRoot.container, "schedule-delete-alpha").disabled,
      ).toBe(true);
      expect(
        getByTestId<HTMLButtonElement>(testRoot.container, "schedule-toggle-beta").disabled,
      ).toBe(true);
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

  it("preserves the create form values when schedule creation fails", async () => {
    schedulesApi.create.mockRejectedValueOnce(new Error("create failed"));

    const testRoot = renderIntoDocument(React.createElement(SchedulesPage, { core: createCore() }));
    try {
      await flushPage();

      await clickAndFlush(getButtonByText(testRoot.container, "Create Schedule"));

      const agentKeyInput = testRoot.container.querySelector<HTMLInputElement>(
        'input[placeholder="agent-key"]',
      );
      expect(agentKeyInput).not.toBeNull();
      if (!agentKeyInput) {
        throw new Error('Expected the "Agent key" input to be rendered');
      }

      act(() => {
        setNativeValue(agentKeyInput, "agent-new");
      });

      await clickAndFlush(getButtonByText(testRoot.container, "Create schedule"));
      await flushPage();

      expect(schedulesApi.create).toHaveBeenCalledTimes(1);
      expect(testRoot.container.textContent).toContain("Failed to create schedule");
      expect(testRoot.container.textContent).toContain("create failed");
      expect(agentKeyInput.value).toBe("agent-new");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("shows a single toast when deleting a schedule fails", async () => {
    const toastError = vi.spyOn(toast, "error").mockImplementation(() => "");
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

      expect(toastError).toHaveBeenCalledWith("Action failed", {
        description: "delete failed",
      });
      expect(testRoot.container.textContent).not.toContain("Schedule deletion failed");
      expect(document.body.textContent).toContain("Delete schedule");
    } finally {
      toastError.mockRestore();
      cleanupTestRoot(testRoot);
    }
  });
});
