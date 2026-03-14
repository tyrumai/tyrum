// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import { createElevatedModeStore, type OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import { AdminAccessProvider } from "../../src/index.js";
import { ApprovalsPage } from "../../src/components/pages/approvals-page.js";
import {
  createApprovedDesktopPairingFixture,
  createDesktopApprovalFixture,
  createDesktopArtifactFixture,
  createPausedDesktopRunFixture,
  createPausedDesktopStepFixture,
  createRunningDesktopAttemptFixture,
  DESKTOP_TAKEOVER_URL,
} from "./approvals-page.desktop.test-fixtures.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

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

describe("ApprovalsPage (desktop approvals)", () => {
  it("renders Desktop op summary and takeover link when available", () => {
    const approval = createDesktopApprovalFixture();
    const pairing = createApprovedDesktopPairingFixture();

    const { store: approvalsStore } = createStore({
      byId: { 1: approval },
      pendingIds: [1],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });

    const { store: pairingStore } = createStore({
      byId: { 99: pairing },
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
      elevatedModeStore: createElevatedModeStore({
        tickIntervalMs: 0,
      }),
    } as unknown as OperatorCore;

    const { container, root } = renderApprovalsPage(core);

    try {
      const summary = container.querySelector<HTMLDivElement>(
        '[data-testid="desktop-approval-summary-1"]',
      );
      expect(summary).not.toBeNull();
      expect(summary?.textContent).toContain("Desktop");
      expect(summary?.textContent).toContain("act");
      expect(summary?.textContent).toContain("click");
      expect(summary?.textContent).toContain("Submit");

      const details = container.querySelector<HTMLDivElement>('[data-testid="approval-details-1"]');
      expect(details).not.toBeNull();
      expect(details?.textContent).toContain("approval:1");

      const takeoverLink = container.querySelector<HTMLAnchorElement>(
        '[data-testid="approval-takeover-1"]',
      );
      expect(takeoverLink).not.toBeNull();
      expect(takeoverLink?.getAttribute("href")).toBe(DESKTOP_TAKEOVER_URL);
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("renders takeover link from node metadata when present", () => {
    const approval = createDesktopApprovalFixture();
    const pairing = createApprovedDesktopPairingFixture({
      label: "tyrum-desktop-sandbox",
      metadata: {
        takeover_url: DESKTOP_TAKEOVER_URL,
      },
    });

    const { store: approvalsStore } = createStore({
      byId: { 1: approval },
      pendingIds: [1],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });

    const { store: pairingStore } = createStore({
      byId: { 99: pairing },
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
      elevatedModeStore: createElevatedModeStore({
        tickIntervalMs: 0,
      }),
    } as unknown as OperatorCore;

    const { container, root } = renderApprovalsPage(core);

    try {
      const takeoverLink = container.querySelector<HTMLAnchorElement>(
        '[data-testid="approval-takeover-1"]',
      );
      expect(takeoverLink).not.toBeNull();
      expect(takeoverLink?.getAttribute("href")).toBe(DESKTOP_TAKEOVER_URL);
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("renders motivation and latest guardian review context", () => {
    const approval = createDesktopApprovalFixture({
      status: "reviewing",
      context: {},
      latestReview: {
        review_id: "11111111-1111-1111-1111-111111111111",
        target_type: "approval",
        target_id: "1",
        reviewer_kind: "guardian",
        reviewer_id: "guardian-1",
        state: "running",
        reason:
          "The request targets a known desktop node and the scope is limited to one form submission.",
        risk_level: "medium",
        risk_score: 42,
        evidence: null,
        decision_payload: null,
        created_at: "2026-01-01T00:00:01.000Z",
        started_at: "2026-01-01T00:00:01.000Z",
        completed_at: null,
      },
    });

    const { store: approvalsStore } = createStore({
      byId: { 1: approval },
      pendingIds: [],
      blockedIds: [1],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });

    const { store: pairingStore } = createStore({
      byId: {},
      pendingIds: [],
      blockedIds: [],
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
      elevatedModeStore: createElevatedModeStore({
        tickIntervalMs: 0,
      }),
    } as unknown as OperatorCore;

    const { container, root } = renderApprovalsPage(core);

    try {
      const motivation = container.querySelector<HTMLDivElement>(
        '[data-testid="approval-motivation-1"]',
      );
      expect(motivation).not.toBeNull();
      expect(motivation?.textContent).toContain("desktop interaction");

      const review = container.querySelector<HTMLDivElement>('[data-testid="approval-review-1"]');
      expect(review).not.toBeNull();
      expect(review?.textContent).toContain("known desktop node");
      expect(review?.textContent).toContain("Risk MEDIUM · score 42");
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("renders desktop artifacts drilldown when available for an approval step", () => {
    const runId = "11111111-1111-1111-1111-111111111111";
    const stepId = "22222222-2222-2222-2222-222222222222";
    const attemptId = "33333333-3333-3333-3333-333333333333";
    const screenshotArtifactId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const treeArtifactId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    const approval = createDesktopApprovalFixture({
      scope: { run_id: runId, step_id: stepId },
    });

    const run = createPausedDesktopRunFixture({
      runId,
      jobId: "44444444-4444-4444-4444-444444444444",
    });

    const step = createPausedDesktopStepFixture({ runId, stepId });

    const screenshotArtifact = createDesktopArtifactFixture({
      artifactId: screenshotArtifactId,
      kind: "screenshot",
      mimeType: "image/png",
      labels: ["screenshot", "desktop"],
    });

    const treeArtifact = createDesktopArtifactFixture({
      artifactId: treeArtifactId,
      kind: "dom_snapshot",
      mimeType: "application/json",
      labels: ["a11y-tree", "desktop"],
    });

    const attempt = createRunningDesktopAttemptFixture({
      attemptId,
      stepId,
      attempt: 1,
      artifacts: [screenshotArtifact, treeArtifact],
    });

    const { store: approvalsStore } = createStore({
      byId: { 1: approval },
      pendingIds: [1],
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

    const { store: runsStore } = createStore({
      runsById: { [runId]: run },
      stepsById: { [stepId]: step },
      attemptsById: { [attemptId]: attempt },
      stepIdsByRunId: { [runId]: [stepId] },
      attemptIdsByStepId: { [stepId]: [attemptId] },
    });

    const core = {
      approvalsStore,
      pairingStore,
      runsStore,
      elevatedModeStore: createElevatedModeStore({
        tickIntervalMs: 0,
      }),
    } as unknown as OperatorCore;

    const { container, root } = renderApprovalsPage(core);

    try {
      const artifactsButton = container.querySelector<HTMLButtonElement>(
        `[data-testid="attempt-artifacts-${attemptId}"]`,
      );
      expect(artifactsButton).not.toBeNull();
      expect(artifactsButton?.textContent).toContain("Artifacts");
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("falls back to the latest attempt that includes artifacts", () => {
    const runId = "11111111-1111-1111-1111-111111111111";
    const stepId = "22222222-2222-2222-2222-222222222222";
    const attemptIdWithArtifacts = "33333333-3333-3333-3333-333333333333";
    const attemptIdWithoutArtifacts = "44444444-4444-4444-4444-444444444444";
    const screenshotArtifactId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const treeArtifactId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    const approval = createDesktopApprovalFixture({
      scope: { run_id: runId, step_id: stepId },
    });

    const run = createPausedDesktopRunFixture({
      runId,
      jobId: "55555555-5555-5555-5555-555555555555",
      attempt: 2,
    });

    const step = createPausedDesktopStepFixture({ runId, stepId });

    const screenshotArtifact = createDesktopArtifactFixture({
      artifactId: screenshotArtifactId,
      kind: "screenshot",
      mimeType: "image/png",
      labels: ["screenshot", "desktop"],
    });

    const treeArtifact = createDesktopArtifactFixture({
      artifactId: treeArtifactId,
      kind: "dom_snapshot",
      mimeType: "application/json",
      labels: ["a11y-tree", "desktop"],
    });

    const attemptWithArtifacts = createRunningDesktopAttemptFixture({
      attemptId: attemptIdWithArtifacts,
      stepId,
      attempt: 1,
      artifacts: [screenshotArtifact, treeArtifact],
    });

    const attemptWithoutArtifacts = createRunningDesktopAttemptFixture({
      attemptId: attemptIdWithoutArtifacts,
      stepId,
      attempt: 2,
      artifacts: [],
    });

    const { store: approvalsStore } = createStore({
      byId: { 1: approval },
      pendingIds: [1],
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

    const { store: runsStore } = createStore({
      runsById: { [runId]: run },
      stepsById: { [stepId]: step },
      attemptsById: {
        [attemptIdWithArtifacts]: attemptWithArtifacts,
        [attemptIdWithoutArtifacts]: attemptWithoutArtifacts,
      },
      stepIdsByRunId: { [runId]: [stepId] },
      attemptIdsByStepId: { [stepId]: [attemptIdWithArtifacts, attemptIdWithoutArtifacts] },
    });

    const core = {
      approvalsStore,
      pairingStore,
      runsStore,
      elevatedModeStore: createElevatedModeStore({
        tickIntervalMs: 0,
      }),
    } as unknown as OperatorCore;

    const { container, root } = renderApprovalsPage(core);

    try {
      const artifactsButton = container.querySelector<HTMLButtonElement>(
        `[data-testid="attempt-artifacts-${attemptIdWithArtifacts}"]`,
      );
      expect(artifactsButton).not.toBeNull();
    } finally {
      cleanupTestRoot({ container, root });
    }
  });
});
