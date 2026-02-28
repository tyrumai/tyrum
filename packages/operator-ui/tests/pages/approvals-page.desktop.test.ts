// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import { ApprovalsPage } from "../../src/components/pages/approvals-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("ApprovalsPage (desktop approvals)", () => {
  it("renders Desktop op summary and takeover link when available", () => {
    const approval = {
      approval_id: 1,
      kind: "workflow_step",
      status: "pending",
      prompt: "Approve execution of 'tool.node.dispatch' (risk=high)",
      context: {
        source: "agent-tool-execution",
        tool_id: "tool.node.dispatch",
        tool_call_id: "tc-1",
        tool_match_target: "tool.node.dispatch.desktop.act",
        args: {
          capability: "tyrum.desktop",
          action: "Desktop",
          args: {
            op: "act",
            target: { kind: "a11y", role: "button", name: "Submit", states: [] },
            action: { kind: "click" },
          },
        },
      },
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
      resolution: null,
    } as const;

    const pairing = {
      pairing_id: 99,
      status: "approved",
      trust_level: "local",
      requested_at: "2026-01-01T00:00:00.000Z",
      node: {
        node_id: "node-1",
        label: "tyrum-desktop-sandbox (takeover: http://localhost:6080/vnc.html?autoconnect=true)",
        last_seen_at: "2026-01-01T00:00:00.000Z",
        capabilities: ["desktop"],
      },
      capability_allowlist: [{ id: "tyrum.desktop", version: "1.0.0" }],
      resolution: {
        decision: "approved",
        resolved_at: "2026-01-01T00:00:01.000Z",
      },
      resolved_at: "2026-01-01T00:00:01.000Z",
    } as const;

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
    } as unknown as OperatorCore;

    const { container, root } = renderIntoDocument(React.createElement(ApprovalsPage, { core }));

    try {
      const summary = container.querySelector<HTMLDivElement>(
        '[data-testid="desktop-approval-summary-1"]',
      );
      expect(summary).not.toBeNull();
      expect(summary?.textContent).toContain("Desktop");
      expect(summary?.textContent).toContain("act");
      expect(summary?.textContent).toContain("click");
      expect(summary?.textContent).toContain("Submit");

      const takeoverLink = container.querySelector<HTMLAnchorElement>(
        '[data-testid="approval-takeover-1"]',
      );
      expect(takeoverLink).not.toBeNull();
      expect(takeoverLink?.getAttribute("href")).toBe(
        "http://localhost:6080/vnc.html?autoconnect=true",
      );
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("renders takeover link from node metadata when present", () => {
    const approval = {
      approval_id: 1,
      kind: "workflow_step",
      status: "pending",
      prompt: "Approve execution of 'tool.node.dispatch' (risk=high)",
      context: {
        source: "agent-tool-execution",
        tool_id: "tool.node.dispatch",
        tool_call_id: "tc-1",
        tool_match_target: "tool.node.dispatch.desktop.act",
        args: {
          capability: "tyrum.desktop",
          action: "Desktop",
          args: {
            op: "act",
            target: { kind: "a11y", role: "button", name: "Submit", states: [] },
            action: { kind: "click" },
          },
        },
      },
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
      resolution: null,
    } as const;

    const pairing = {
      pairing_id: 99,
      status: "approved",
      trust_level: "local",
      requested_at: "2026-01-01T00:00:00.000Z",
      node: {
        node_id: "node-1",
        label: "tyrum-desktop-sandbox",
        last_seen_at: "2026-01-01T00:00:00.000Z",
        capabilities: ["desktop"],
        metadata: {
          takeover_url: "http://localhost:6080/vnc.html?autoconnect=true",
        },
      },
      capability_allowlist: [{ id: "tyrum.desktop", version: "1.0.0" }],
      resolution: {
        decision: "approved",
        resolved_at: "2026-01-01T00:00:01.000Z",
      },
      resolved_at: "2026-01-01T00:00:01.000Z",
    } as const;

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
    } as unknown as OperatorCore;

    const { container, root } = renderIntoDocument(React.createElement(ApprovalsPage, { core }));

    try {
      const takeoverLink = container.querySelector<HTMLAnchorElement>(
        '[data-testid="approval-takeover-1"]',
      );
      expect(takeoverLink).not.toBeNull();
      expect(takeoverLink?.getAttribute("href")).toBe(
        "http://localhost:6080/vnc.html?autoconnect=true",
      );
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

    const approval = {
      approval_id: 1,
      kind: "workflow_step",
      status: "pending",
      prompt: "Approve execution of 'tool.node.dispatch' (risk=high)",
      context: {
        source: "agent-tool-execution",
        tool_id: "tool.node.dispatch",
        tool_call_id: "tc-1",
        tool_match_target: "tool.node.dispatch.desktop.act",
        args: {
          capability: "tyrum.desktop",
          action: "Desktop",
          args: {
            op: "act",
            target: { kind: "a11y", role: "button", name: "Submit", states: [] },
            action: { kind: "click" },
          },
        },
      },
      scope: { run_id: runId, step_index: 0 },
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
      resolution: null,
    } as const;

    const run = {
      run_id: runId,
      job_id: "44444444-4444-4444-4444-444444444444",
      key: "key-1",
      lane: "main",
      status: "paused",
      attempt: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: null,
      paused_reason: "approval",
      paused_detail: "approval pending",
    } as const;

    const step = {
      step_id: stepId,
      run_id: runId,
      step_index: 0,
      status: "paused",
      action: { type: "Desktop", args: {} },
      created_at: "2026-01-01T00:00:00.000Z",
      approval_id: 1,
    } as const;

    const screenshotArtifact = {
      artifact_id: screenshotArtifactId,
      uri: `artifact://${screenshotArtifactId}`,
      kind: "screenshot",
      created_at: "2026-01-01T00:00:00.000Z",
      mime_type: "image/png",
      labels: ["screenshot", "desktop"],
    } as const;

    const treeArtifact = {
      artifact_id: treeArtifactId,
      uri: `artifact://${treeArtifactId}`,
      kind: "dom_snapshot",
      created_at: "2026-01-01T00:00:00.000Z",
      mime_type: "application/json",
      labels: ["a11y-tree", "desktop"],
    } as const;

    const attempt = {
      attempt_id: attemptId,
      step_id: stepId,
      attempt: 1,
      status: "running",
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: null,
      error: null,
      artifacts: [screenshotArtifact, treeArtifact],
    } as const;

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
    } as unknown as OperatorCore;

    const { container, root } = renderIntoDocument(React.createElement(ApprovalsPage, { core }));

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

    const approval = {
      approval_id: 1,
      kind: "workflow_step",
      status: "pending",
      prompt: "Approve execution of 'tool.node.dispatch' (risk=high)",
      context: {
        source: "agent-tool-execution",
        tool_id: "tool.node.dispatch",
        tool_call_id: "tc-1",
        tool_match_target: "tool.node.dispatch.desktop.act",
        args: {
          capability: "tyrum.desktop",
          action: "Desktop",
          args: {
            op: "act",
            target: { kind: "a11y", role: "button", name: "Submit", states: [] },
            action: { kind: "click" },
          },
        },
      },
      scope: { run_id: runId, step_index: 0 },
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
      resolution: null,
    } as const;

    const run = {
      run_id: runId,
      job_id: "55555555-5555-5555-5555-555555555555",
      key: "key-1",
      lane: "main",
      status: "paused",
      attempt: 2,
      created_at: "2026-01-01T00:00:00.000Z",
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: null,
      paused_reason: "approval",
      paused_detail: "approval pending",
    } as const;

    const step = {
      step_id: stepId,
      run_id: runId,
      step_index: 0,
      status: "paused",
      action: { type: "Desktop", args: {} },
      created_at: "2026-01-01T00:00:00.000Z",
      approval_id: 1,
    } as const;

    const screenshotArtifact = {
      artifact_id: screenshotArtifactId,
      uri: `artifact://${screenshotArtifactId}`,
      kind: "screenshot",
      created_at: "2026-01-01T00:00:00.000Z",
      mime_type: "image/png",
      labels: ["screenshot", "desktop"],
    } as const;

    const treeArtifact = {
      artifact_id: treeArtifactId,
      uri: `artifact://${treeArtifactId}`,
      kind: "dom_snapshot",
      created_at: "2026-01-01T00:00:00.000Z",
      mime_type: "application/json",
      labels: ["a11y-tree", "desktop"],
    } as const;

    const attemptWithArtifacts = {
      attempt_id: attemptIdWithArtifacts,
      step_id: stepId,
      attempt: 1,
      status: "running",
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: null,
      error: null,
      artifacts: [screenshotArtifact, treeArtifact],
    } as const;

    const attemptWithoutArtifacts = {
      attempt_id: attemptIdWithoutArtifacts,
      step_id: stepId,
      attempt: 2,
      status: "running",
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: null,
      error: null,
      artifacts: [],
    } as const;

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
    } as unknown as OperatorCore;

    const { container, root } = renderIntoDocument(React.createElement(ApprovalsPage, { core }));

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
