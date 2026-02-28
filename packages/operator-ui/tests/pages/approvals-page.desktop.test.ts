// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import { ApprovalsPage } from "../../src/pages/approvals-page.js";
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

    const core = {
      approvalsStore,
      pairingStore,
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
});
