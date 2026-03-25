// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import {
  createElevatedModeStore,
  ElevatedModeRequiredError,
  type OperatorCore,
} from "../../../operator-app/src/index.js";
import { createStore } from "../../../operator-app/src/store.js";
import { AdminAccessProvider, toast } from "../../src/index.js";
import { ApprovalsPage } from "../../src/components/pages/approvals-page.js";
import { cleanupTestRoot, click, renderIntoDocument } from "../test-utils.js";

const NOOP_ADMIN_ACCESS_CONTROLLER = {
  enter: async () => {},
  exit: async () => {},
};

function renderApprovalsPage(core: OperatorCore) {
  return renderIntoDocument(
    React.createElement(
      AdminAccessProvider,
      {
        core,
        mode: "desktop",
        adminAccessController: NOOP_ADMIN_ACCESS_CONTROLLER,
      },
      React.createElement(ApprovalsPage, { core }),
    ),
  );
}

describe("ApprovalsPage always approve", () => {
  it("offers always-approve options when suggested overrides exist", async () => {
    const approval = {
      approval_id: "11111111-1111-1111-1111-111111111111",
      approval_key: "approval:1",
      kind: "workflow_step",
      status: "pending",
      prompt: "Approve execution of 'tool.desktop.act' on node 'node-1' (risk=high)",
      context: {
        policy: {
          suggested_overrides: [
            {
              tool_id: "tool.desktop.act",
              pattern: "tool.desktop.act",
              workspace_id: "22222222-2222-4222-8222-222222222222",
            },
          ],
        },
      },
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
      resolution: null,
    } as const;
    const resolve = vi.fn(async () => ({
      approval: { ...approval, status: "approved" },
      createdOverrides: [
        {
          policy_override_id: "33333333-3333-4333-8333-333333333333",
          status: "active",
          created_at: "2026-01-01T00:00:01.000Z",
          agent_id: "44444444-4444-4444-8444-444444444444",
          workspace_id: "22222222-2222-4222-8222-222222222222",
          tool_id: "tool.desktop.act",
          pattern: "tool.desktop.act",
          created_from_approval_id: approval.approval_id,
        },
      ],
    }));

    const { store: approvalsBaseStore } = createStore({
      byId: { [approval.approval_id]: approval },
      pendingIds: [approval.approval_id],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });
    const approvalsStore = {
      ...approvalsBaseStore,
      resolve,
    };

    const { store: pairingStore } = createStore({
      byId: {},
      pendingIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });
    const { store: runsStore } = createStore({
      runsById: {},
      stepsById: {},
      attemptsById: {},
      stepIdsByRunId: {},
      attemptIdsByStepId: {},
    });

    const core = {
      approvalsStore,
      pairingStore,
      runsStore,
      httpBaseUrl: "http://example.test",
      elevatedModeStore: createElevatedModeStore({
        tickIntervalMs: 0,
      }),
    } as unknown as OperatorCore;

    core.elevatedModeStore.enter({
      elevatedToken: "test-elevated-token",
      expiresAt: "2099-01-01T00:10:00.000Z",
    });

    const { container, root } = renderApprovalsPage(core);

    try {
      const approveButton = container.querySelector<HTMLButtonElement>(
        `[data-testid="approval-approve-${approval.approval_id}"]`,
      );
      const alwaysButton = container.querySelector<HTMLButtonElement>(
        `[data-testid="approval-always-${approval.approval_id}"]`,
      );
      expect(approveButton?.textContent).toContain("Approve once");
      expect(alwaysButton).not.toBeNull();

      await act(async () => {
        click(alwaysButton!);
        await Promise.resolve();
      });

      const dialog = document.querySelector<HTMLElement>(
        `[data-testid="approval-always-dialog-${approval.approval_id}"]`,
      );
      const firstOption = document.querySelector<HTMLElement>(
        `[data-testid="approval-always-option-${approval.approval_id}-0"]`,
      );
      const confirm = document.querySelector<HTMLButtonElement>(
        `[data-testid="approval-always-confirm-${approval.approval_id}"]`,
      );

      expect(dialog?.textContent ?? "").toContain("Recommended");
      expect(dialog?.textContent ?? "").toContain("Desktop act actions in this scope");
      expect(firstOption?.getAttribute("data-state")).toBe("checked");

      await act(async () => {
        click(confirm!);
        await Promise.resolve();
      });

      expect(resolve).toHaveBeenCalledWith({
        approvalId: approval.approval_id,
        decision: "approved",
        mode: "always",
        overrides: [
          {
            tool_id: "tool.desktop.act",
            pattern: "tool.desktop.act",
            workspace_id: "22222222-2222-4222-8222-222222222222",
          },
        ],
      });
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("shows always approve for execution-engine policy approvals", async () => {
    const approval = {
      approval_id: "55555555-5555-4555-8555-555555555555",
      approval_key: "approval:2",
      kind: "policy",
      status: "pending",
      prompt: "Policy approval required to continue execution",
      context: {
        source: "execution-engine",
        tool_id: "webfetch",
        tool_match_target: "https://example.com/data",
        decision: "require_approval",
        policy: {
          policy_snapshot_id: "66666666-6666-4666-8666-666666666666",
          workspace_id: "22222222-2222-4222-8222-222222222222",
          suggested_overrides: [
            {
              tool_id: "webfetch",
              pattern: "https://example.com/data",
              workspace_id: "22222222-2222-4222-8222-222222222222",
            },
          ],
        },
      },
      scope: {
        key: "agent:default:main",
        lane: "heartbeat",
        run_id: "77777777-7777-4777-8777-777777777777",
        step_id: "88888888-8888-4888-8888-888888888888",
      },
      created_at: "2026-03-10T18:25:06.000Z",
      expires_at: null,
      resolution: null,
    } as const;
    const resolve = vi.fn(async () => ({
      approval: { ...approval, status: "approved" },
      createdOverrides: [],
    }));

    const { store: approvalsBaseStore } = createStore({
      byId: { [approval.approval_id]: approval },
      pendingIds: [approval.approval_id],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });
    const approvalsStore = {
      ...approvalsBaseStore,
      resolve,
    };

    const { store: pairingStore } = createStore({
      byId: {},
      pendingIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });
    const { store: runsStore } = createStore({
      runsById: {},
      stepsById: {},
      attemptsById: {},
      stepIdsByRunId: {},
      attemptIdsByStepId: {},
    });

    const core = {
      approvalsStore,
      pairingStore,
      runsStore,
      httpBaseUrl: "http://example.test",
      elevatedModeStore: createElevatedModeStore({
        tickIntervalMs: 0,
      }),
    } as unknown as OperatorCore;

    core.elevatedModeStore.enter({
      elevatedToken: "test-elevated-token",
      expiresAt: "2099-01-01T00:10:00.000Z",
    });

    const { container, root } = renderApprovalsPage(core);

    try {
      expect(container.textContent).toContain("Policy approval required to continue execution");
      const alwaysButton = container.querySelector<HTMLButtonElement>(
        `[data-testid="approval-always-${approval.approval_id}"]`,
      );
      expect(alwaysButton).not.toBeNull();
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("re-prompts for admin access instead of resolving when always approve is confirmed while inactive", async () => {
    const approval = {
      approval_id: "99999999-9999-4999-8999-999999999999",
      approval_key: "approval:3",
      kind: "workflow_step",
      status: "pending",
      prompt: "Approve execution of 'tool.desktop.act' on node 'node-1' (risk=high)",
      context: {
        policy: {
          suggested_overrides: [
            {
              tool_id: "tool.desktop.act",
              pattern: "tool.desktop.act",
            },
          ],
        },
      },
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
      resolution: null,
    } as const;
    const resolve = vi.fn(async () => ({
      approval: { ...approval, status: "approved" },
      createdOverrides: [],
    }));

    const { store: approvalsBaseStore } = createStore({
      byId: { [approval.approval_id]: approval },
      pendingIds: [approval.approval_id],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });
    const approvalsStore = {
      ...approvalsBaseStore,
      resolve,
    };
    const { store: pairingStore } = createStore({
      byId: {},
      pendingIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });
    const { store: runsStore } = createStore({
      runsById: {},
      stepsById: {},
      attemptsById: {},
      stepIdsByRunId: {},
      attemptIdsByStepId: {},
    });

    const core = {
      approvalsStore,
      pairingStore,
      runsStore,
      httpBaseUrl: "http://example.test",
      elevatedModeStore: createElevatedModeStore({
        tickIntervalMs: 0,
      }),
    } as unknown as OperatorCore;

    const { container, root } = renderApprovalsPage(core);

    try {
      const alwaysButton = container.querySelector<HTMLButtonElement>(
        `[data-testid="approval-always-${approval.approval_id}"]`,
      );
      expect(alwaysButton).not.toBeNull();

      await act(async () => {
        click(alwaysButton!);
        await Promise.resolve();
      });

      const confirm = document.querySelector<HTMLButtonElement>(
        `[data-testid="approval-always-confirm-${approval.approval_id}"]`,
      );
      expect(confirm).not.toBeNull();

      await act(async () => {
        click(confirm!);
        await Promise.resolve();
      });

      expect(resolve).toHaveBeenCalledTimes(0);
      expect(document.querySelector('[data-testid="elevated-mode-dialog"]')).not.toBeNull();
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("re-prompts for admin access without showing an error toast when resolve races with expiry", async () => {
    const toastError = vi.spyOn(toast, "error").mockImplementation(() => "" as unknown as string);
    const approval = {
      approval_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      approval_key: "approval:4",
      kind: "workflow_step",
      status: "pending",
      prompt: "Approve execution of 'tool.desktop.act' on node 'node-1' (risk=high)",
      context: {
        policy: {
          suggested_overrides: [
            {
              tool_id: "tool.desktop.act",
              pattern: "tool.desktop.act",
            },
          ],
        },
      },
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
      resolution: null,
    } as const;
    const resolve = vi.fn(async () => {
      throw new ElevatedModeRequiredError("Authorize admin access to resolve approvals.");
    });

    const { store: approvalsBaseStore } = createStore({
      byId: { [approval.approval_id]: approval },
      pendingIds: [approval.approval_id],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });
    const approvalsStore = {
      ...approvalsBaseStore,
      resolve,
    };
    const { store: pairingStore } = createStore({
      byId: {},
      pendingIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });
    const { store: runsStore } = createStore({
      runsById: {},
      stepsById: {},
      attemptsById: {},
      stepIdsByRunId: {},
      attemptIdsByStepId: {},
    });

    const core = {
      approvalsStore,
      pairingStore,
      runsStore,
      httpBaseUrl: "http://example.test",
      elevatedModeStore: createElevatedModeStore({
        tickIntervalMs: 0,
      }),
    } as unknown as OperatorCore;
    core.elevatedModeStore.enter({
      elevatedToken: "test-elevated-token",
      expiresAt: "2099-01-01T00:10:00.000Z",
    });

    const { container, root } = renderApprovalsPage(core);

    try {
      const approveButton = container.querySelector<HTMLButtonElement>(
        `[data-testid="approval-approve-${approval.approval_id}"]`,
      );
      expect(approveButton).not.toBeNull();

      await act(async () => {
        click(approveButton!);
        await Promise.resolve();
      });

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[data-testid="elevated-mode-dialog"]')).not.toBeNull();
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      cleanupTestRoot({ container, root });
    }
  });
});
