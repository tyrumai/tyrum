// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { createElevatedModeStore, type OperatorCore } from "../../../operator-app/src/index.js";
import { createStore } from "../../../operator-app/src/store.js";
import { AdminAccessProvider } from "../../src/index.js";
import { ApprovalsPage } from "../../src/components/pages/approvals-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";
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

describe("ApprovalsPage history and filters", () => {
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
      stepsById: {},
      attemptsById: {},
      stepIdsByTurnId: {},
      attemptIdsByStepId: {},
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

  it("filters pending approvals and history by managed agent", async () => {
    const agentOneId = "00000000-0000-4000-8000-000000000011";
    const agentTwoId = "00000000-0000-4000-8000-000000000022";
    const pendingAgentOne = {
      ...createDesktopApprovalFixture({
        approvalId: 1,
        agentId: agentOneId,
        status: "awaiting_human",
      }),
      prompt: "Pending agent one",
    } as const;
    const pendingAgentTwo = {
      ...createDesktopApprovalFixture({
        approvalId: 2,
        agentId: agentTwoId,
        status: "awaiting_human",
      }),
      prompt: "Pending agent two",
    } as const;
    const historyAgentOne = {
      ...createDesktopApprovalFixture({
        approvalId: 3,
        agentId: agentOneId,
        status: "approved",
      }),
      prompt: "History agent one",
    } as const;
    const historyAgentTwo = {
      ...createDesktopApprovalFixture({
        approvalId: 4,
        agentId: agentTwoId,
        status: "approved",
      }),
      prompt: "History agent two",
    } as const;

    const { store: approvalsStore } = createStore({
      byId: {
        [pendingAgentOne.approval_id]: pendingAgentOne,
        [pendingAgentTwo.approval_id]: pendingAgentTwo,
        [historyAgentOne.approval_id]: historyAgentOne,
        [historyAgentTwo.approval_id]: historyAgentTwo,
      },
      blockedIds: [String(pendingAgentOne.approval_id), String(pendingAgentTwo.approval_id)],
      pendingIds: [String(pendingAgentOne.approval_id), String(pendingAgentTwo.approval_id)],
      historyIds: [String(historyAgentOne.approval_id), String(historyAgentTwo.approval_id)],
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
      stepsById: {},
      attemptsById: {},
      stepIdsByTurnId: {},
      attemptIdsByStepId: {},
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

      const filter = container.querySelector<HTMLSelectElement>(
        '[data-testid="approvals-agent-filter"]',
      );
      expect(filter).not.toBeNull();

      await act(async () => {
        filter!.value = agentOneId;
        filter!.dispatchEvent(new Event("change", { bubbles: true }));
        await Promise.resolve();
      });

      const needsAttention = container.querySelector<HTMLElement>(
        '[data-testid="approvals-needs-attention"]',
      );
      const history = container.querySelector<HTMLElement>('[data-testid="approvals-history"]');

      expect(needsAttention?.textContent).toContain("Pending agent one");
      expect(needsAttention?.textContent).not.toContain("Pending agent two");
      expect(history?.textContent).toContain("History agent one");
      expect(history?.textContent).not.toContain("History agent two");
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("falls back to approval agent ids when managed-agent metadata is unavailable", async () => {
    const agentOneId = "00000000-0000-4000-8000-000000000031";
    const agentTwoId = "00000000-0000-4000-8000-000000000032";
    const pendingAgentOne = {
      ...createDesktopApprovalFixture({
        approvalId: 11,
        agentId: agentOneId,
        status: "awaiting_human",
      }),
      prompt: "Pending fallback agent one",
    } as const;
    const historyAgentTwo = {
      ...createDesktopApprovalFixture({
        approvalId: 12,
        agentId: agentTwoId,
        status: "approved",
      }),
      prompt: "History fallback agent two",
    } as const;

    const { store: approvalsStore } = createStore({
      byId: {
        [pendingAgentOne.approval_id]: pendingAgentOne,
        [historyAgentTwo.approval_id]: historyAgentTwo,
      },
      blockedIds: [String(pendingAgentOne.approval_id)],
      pendingIds: [String(pendingAgentOne.approval_id)],
      historyIds: [String(historyAgentTwo.approval_id)],
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
      stepsById: {},
      attemptsById: {},
      stepIdsByTurnId: {},
      attemptIdsByStepId: {},
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
      const filter = container.querySelector<HTMLSelectElement>(
        '[data-testid="approvals-agent-filter"]',
      );

      expect(filter).not.toBeNull();
      expect(
        [...(filter?.options ?? [])].some((option) => option.value === agentOneId),
      ).toBeTruthy();
      expect(
        [...(filter?.options ?? [])].some((option) => option.value === agentTwoId),
      ).toBeTruthy();

      await act(async () => {
        filter!.value = agentTwoId;
        filter!.dispatchEvent(new Event("change", { bubbles: true }));
        await Promise.resolve();
      });

      const needsAttention = container.querySelector<HTMLElement>(
        '[data-testid="approvals-needs-attention"]',
      );
      const history = container.querySelector<HTMLElement>('[data-testid="approvals-history"]');

      expect(needsAttention?.textContent).not.toContain("Pending fallback agent one");
      expect(history?.textContent).toContain("History fallback agent two");
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("adds fallback filter options for approvals missing from the managed-agent list", async () => {
    const managedAgentId = "00000000-0000-4000-8000-000000000041";
    const fallbackAgentId = "00000000-0000-4000-8000-000000000042";
    const pendingManagedAgent = {
      ...createDesktopApprovalFixture({
        approvalId: 21,
        agentId: managedAgentId,
        status: "awaiting_human",
      }),
      prompt: "Pending managed agent",
    } as const;
    const historyFallbackAgent = {
      ...createDesktopApprovalFixture({
        approvalId: 22,
        agentId: fallbackAgentId,
        status: "approved",
      }),
      prompt: "History fallback-only agent",
    } as const;

    const { store: approvalsStore } = createStore({
      byId: {
        [pendingManagedAgent.approval_id]: pendingManagedAgent,
        [historyFallbackAgent.approval_id]: historyFallbackAgent,
      },
      blockedIds: [String(pendingManagedAgent.approval_id)],
      pendingIds: [String(pendingManagedAgent.approval_id)],
      historyIds: [String(historyFallbackAgent.approval_id)],
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
      stepsById: {},
      attemptsById: {},
      stepIdsByTurnId: {},
      attemptIdsByStepId: {},
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
                agent_id: managedAgentId,
                agent_key: "managed",
                created_at: null,
                updated_at: null,
                has_config: true,
                has_identity: true,
                can_delete: true,
                persona: {
                  name: "Managed Agent",
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

      const filter = container.querySelector<HTMLSelectElement>(
        '[data-testid="approvals-agent-filter"]',
      );

      expect(filter).not.toBeNull();
      expect(
        [...(filter?.options ?? [])].some((option) => option.value === fallbackAgentId),
      ).toBeTruthy();

      await act(async () => {
        filter!.value = fallbackAgentId;
        filter!.dispatchEvent(new Event("change", { bubbles: true }));
        await Promise.resolve();
      });

      const needsAttention = container.querySelector<HTMLElement>(
        '[data-testid="approvals-needs-attention"]',
      );
      const history = container.querySelector<HTMLElement>('[data-testid="approvals-history"]');

      expect(needsAttention?.textContent).not.toContain("Pending managed agent");
      expect(history?.textContent).toContain("History fallback-only agent");
    } finally {
      cleanupTestRoot({ container, root });
    }
  });
});
