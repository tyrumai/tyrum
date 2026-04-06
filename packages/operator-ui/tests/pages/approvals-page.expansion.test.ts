// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { createElevatedModeStore, type OperatorCore } from "../../../operator-app/src/index.js";
import { createStore } from "../../../operator-app/src/store.js";
import { AdminAccessProvider } from "../../src/index.js";
import { ApprovalsPage } from "../../src/components/pages/approvals-page.js";
import { cleanupTestRoot, click, renderIntoDocument } from "../test-utils.js";
import { createDesktopApprovalFixture } from "./approvals-page.desktop.test-fixtures.js";

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

function expandApprovalRow(
  container: HTMLElement,
  section: "active" | "history",
  approvalId: string,
): void {
  const row = container.querySelector<HTMLElement>(
    `[data-testid="approval-${section === "active" ? "active" : "history"}-row-${approvalId}"]`,
  );
  if (!row) {
    throw new Error(`Approval row ${approvalId} not found in ${section}`);
  }

  act(() => {
    click(row);
  });
}

describe("ApprovalsPage expansion behavior", () => {
  it("renders resolved approvals in the history section without action buttons", () => {
    const pendingApproval = createDesktopApprovalFixture({
      approvalId: 1,
      status: "awaiting_human",
    });
    const approvedApproval = {
      ...createDesktopApprovalFixture({
        approvalId: 2,
        status: "approved",
      }),
      prompt: "Previously approved desktop action",
      latest_review: {
        review_id: "history-review-1",
        target_type: "approval",
        target_id: "2",
        reviewer_kind: "human",
        reviewer_id: null,
        state: "approved",
        reason: "Looks safe.",
        risk_level: null,
        risk_score: null,
        evidence: null,
        decision_payload: null,
        created_at: "2026-01-01T00:00:01.000Z",
        started_at: "2026-01-01T00:00:01.000Z",
        completed_at: "2026-01-01T00:00:02.000Z",
      },
    } as const;

    const { store: approvalsStore } = createStore({
      byId: {
        [pendingApproval.approval_id]: pendingApproval,
        [approvedApproval.approval_id]: approvedApproval,
      },
      blockedIds: [String(pendingApproval.approval_id)],
      pendingIds: [String(pendingApproval.approval_id)],
      historyIds: [String(approvedApproval.approval_id)],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });

    const { store: pairingStore } = createStore({
      byId: {},
      pendingIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });

    const { store: turnsStore } = createStore({
      turnsById: {},
      turnItemsById: {},
      turnItemIdsByTurnId: {},
    });

    const core = {
      approvalsStore,
      pairingStore,
      turnsStore,
      elevatedModeStore: createElevatedModeStore({
        tickIntervalMs: 0,
      }),
    } as unknown as OperatorCore;

    const { container, root } = renderApprovalsPage(core);

    try {
      expandApprovalRow(container, "history", String(approvedApproval.approval_id));

      const historySection = container.querySelector<HTMLElement>(
        '[data-testid="approvals-history"]',
      );
      expect(historySection?.textContent).toContain("Previously approved desktop action");
      expect(historySection?.textContent).toContain("Resolved as approved.");
      expect(
        container.querySelector(`[data-testid="approval-approve-${approvedApproval.approval_id}"]`),
      ).toBeNull();
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("auto-expands the first human-review row and skips guardian-only rows", () => {
    const queuedApproval = {
      ...createDesktopApprovalFixture({
        approvalId: 10,
        status: "queued",
      }),
      prompt: "Queued approval",
    } as const;
    const reviewingApproval = {
      ...createDesktopApprovalFixture({
        approvalId: 11,
        status: "reviewing",
      }),
      prompt: "Reviewing approval",
    } as const;
    const awaitingHumanApproval = {
      ...createDesktopApprovalFixture({
        approvalId: 12,
        status: "awaiting_human",
      }),
      prompt: "Awaiting human approval",
    } as const;

    const { store: approvalsStore } = createStore({
      byId: {
        [queuedApproval.approval_id]: queuedApproval,
        [reviewingApproval.approval_id]: reviewingApproval,
        [awaitingHumanApproval.approval_id]: awaitingHumanApproval,
      },
      blockedIds: [
        String(queuedApproval.approval_id),
        String(reviewingApproval.approval_id),
        String(awaitingHumanApproval.approval_id),
      ],
      pendingIds: [String(awaitingHumanApproval.approval_id)],
      historyIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });

    const { store: pairingStore } = createStore({
      byId: {},
      pendingIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });

    const { store: turnsStore } = createStore({
      turnsById: {},
      turnItemsById: {},
      turnItemIdsByTurnId: {},
    });

    const core = {
      approvalsStore,
      pairingStore,
      turnsStore,
      elevatedModeStore: createElevatedModeStore({
        tickIntervalMs: 0,
      }),
    } as unknown as OperatorCore;

    const { container, root } = renderApprovalsPage(core);

    try {
      expect(container.querySelector('[data-testid="approval-expanded-10"]')).toBeNull();
      expect(container.querySelector('[data-testid="approval-expanded-11"]')).toBeNull();
      expect(container.querySelector('[data-testid="approval-expanded-12"]')).not.toBeNull();
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("keeps only one expanded row across active approvals and history", () => {
    const pendingApproval = {
      ...createDesktopApprovalFixture({
        approvalId: 20,
        status: "awaiting_human",
      }),
      prompt: "Pending approval",
    } as const;
    const historyApproval = {
      ...createDesktopApprovalFixture({
        approvalId: 21,
        status: "approved",
      }),
      prompt: "History approval",
    } as const;

    const { store: approvalsStore } = createStore({
      byId: {
        [pendingApproval.approval_id]: pendingApproval,
        [historyApproval.approval_id]: historyApproval,
      },
      blockedIds: [String(pendingApproval.approval_id)],
      pendingIds: [String(pendingApproval.approval_id)],
      historyIds: [String(historyApproval.approval_id)],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });

    const { store: pairingStore } = createStore({
      byId: {},
      pendingIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });

    const { store: turnsStore } = createStore({
      turnsById: {},
      turnItemsById: {},
      turnItemIdsByTurnId: {},
    });

    const core = {
      approvalsStore,
      pairingStore,
      turnsStore,
      elevatedModeStore: createElevatedModeStore({
        tickIntervalMs: 0,
      }),
    } as unknown as OperatorCore;

    const { container, root } = renderApprovalsPage(core);

    try {
      expect(container.querySelector('[data-testid="approval-expanded-20"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="approval-expanded-21"]')).toBeNull();

      expandApprovalRow(container, "history", String(historyApproval.approval_id));

      expect(container.querySelector('[data-testid="approval-expanded-20"]')).toBeNull();
      expect(container.querySelector('[data-testid="approval-expanded-21"]')).not.toBeNull();
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("moves expansion back to the next active human-review row when a manual active row resolves", async () => {
    const firstPendingApproval = {
      ...createDesktopApprovalFixture({
        approvalId: 30,
        status: "awaiting_human",
      }),
      prompt: "First pending approval",
    } as const;
    const secondPendingApproval = {
      ...createDesktopApprovalFixture({
        approvalId: 31,
        status: "awaiting_human",
      }),
      prompt: "Second pending approval",
    } as const;

    const approvalsState = createStore({
      byId: {
        [firstPendingApproval.approval_id]: firstPendingApproval,
        [secondPendingApproval.approval_id]: secondPendingApproval,
      },
      blockedIds: [
        String(firstPendingApproval.approval_id),
        String(secondPendingApproval.approval_id),
      ],
      pendingIds: [
        String(firstPendingApproval.approval_id),
        String(secondPendingApproval.approval_id),
      ],
      historyIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });
    const approvalsStore = approvalsState.store;

    const { store: pairingStore } = createStore({
      byId: {},
      pendingIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });

    const { store: turnsStore } = createStore({
      turnsById: {},
      turnItemsById: {},
      turnItemIdsByTurnId: {},
    });

    const core = {
      approvalsStore,
      pairingStore,
      turnsStore,
      elevatedModeStore: createElevatedModeStore({
        tickIntervalMs: 0,
      }),
    } as unknown as OperatorCore;

    const { container, root } = renderApprovalsPage(core);

    try {
      expandApprovalRow(container, "active", String(secondPendingApproval.approval_id));
      expect(container.querySelector('[data-testid="approval-expanded-31"]')).not.toBeNull();

      await act(async () => {
        approvalsState.setState((prev) => ({
          ...prev,
          byId: {
            ...prev.byId,
            [secondPendingApproval.approval_id]: {
              ...secondPendingApproval,
              status: "approved",
            },
          },
          blockedIds: [String(firstPendingApproval.approval_id)],
          pendingIds: [String(firstPendingApproval.approval_id)],
          historyIds: [String(secondPendingApproval.approval_id)],
        }));
        await Promise.resolve();
      });

      expect(container.querySelector('[data-testid="approval-expanded-31"]')).toBeNull();
      expect(container.querySelector('[data-testid="approval-expanded-30"]')).not.toBeNull();
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("recomputes the expanded active row when the agent filter hides the current row", async () => {
    const agentOneId = "00000000-0000-4000-8000-000000000051";
    const agentTwoId = "00000000-0000-4000-8000-000000000052";
    const pendingAgentOne = {
      ...createDesktopApprovalFixture({
        approvalId: 40,
        agentId: agentOneId,
        status: "awaiting_human",
      }),
      prompt: "Pending agent one",
    } as const;
    const pendingAgentTwo = {
      ...createDesktopApprovalFixture({
        approvalId: 41,
        agentId: agentTwoId,
        status: "awaiting_human",
      }),
      prompt: "Pending agent two",
    } as const;

    const { store: approvalsStore } = createStore({
      byId: {
        [pendingAgentOne.approval_id]: pendingAgentOne,
        [pendingAgentTwo.approval_id]: pendingAgentTwo,
      },
      blockedIds: [String(pendingAgentOne.approval_id), String(pendingAgentTwo.approval_id)],
      pendingIds: [String(pendingAgentOne.approval_id), String(pendingAgentTwo.approval_id)],
      historyIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });

    const { store: pairingStore } = createStore({
      byId: {},
      pendingIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });

    const { store: turnsStore } = createStore({
      turnsById: {},
      turnItemsById: {},
      turnItemIdsByTurnId: {},
    });

    const core = {
      approvalsStore,
      pairingStore,
      turnsStore,
      elevatedModeStore: createElevatedModeStore({
        tickIntervalMs: 0,
      }),
      http: {
        agents: {
          list: async () => ({
            agents: [
              {
                agent_id: agentOneId,
                agent_key: "alpha",
                created_at: null,
                updated_at: null,
                has_config: true,
                has_identity: true,
                can_delete: true,
                persona: {
                  name: "Alpha Agent",
                  description: "",
                  tone: "direct",
                  palette: "graphite",
                  character: "operator",
                },
              },
              {
                agent_id: agentTwoId,
                agent_key: "beta",
                created_at: null,
                updated_at: null,
                has_config: true,
                has_identity: true,
                can_delete: true,
                persona: {
                  name: "Beta Agent",
                  description: "",
                  tone: "direct",
                  palette: "graphite",
                  character: "operator",
                },
              },
            ],
          }),
        },
      },
    } as unknown as OperatorCore & {
      http: OperatorCore["admin"];
    };
    core.admin = core.http;

    const { container, root } = renderApprovalsPage(core);

    try {
      await act(async () => {
        await Promise.resolve();
      });

      expect(container.querySelector('[data-testid="approval-expanded-40"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="approval-expanded-41"]')).toBeNull();

      const filter = container.querySelector<HTMLSelectElement>(
        '[data-testid="approvals-agent-filter"]',
      );
      expect(filter).not.toBeNull();

      await act(async () => {
        filter!.value = agentTwoId;
        filter!.dispatchEvent(new Event("change", { bubbles: true }));
        await Promise.resolve();
      });

      expect(container.querySelector('[data-testid="approval-expanded-40"]')).toBeNull();
      expect(container.querySelector('[data-testid="approval-expanded-41"]')).not.toBeNull();
    } finally {
      cleanupTestRoot({ container, root });
    }
  });
});
