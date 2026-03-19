// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { createElevatedModeStore, type OperatorCore } from "../../../operator-app/src/index.js";
import { AdminAccessProvider } from "../../src/index.js";
import { PendingPairingCard } from "../../src/components/pages/pairing-page.cards.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const NOOP_ADMIN_ACCESS_CONTROLLER = {
  enter: async () => {},
  exit: async () => {},
};

describe("PendingPairingCard", () => {
  it("renders motivation and latest guardian review context", () => {
    const pairing = {
      pairing_id: 1,
      status: "reviewing",
      motivation: "The node requested remote execution access for a desktop workflow.",
      trust_level: "remote",
      requested_at: "2026-01-01T00:00:00.000Z",
      node: {
        node_id: "node-1",
        label: "desktop-node",
        last_seen_at: "2026-01-01T00:00:00.000Z",
        capabilities: [{ id: "tyrum.desktop.act", version: "1.0.0" }],
      },
      capability_allowlist: [{ id: "tyrum.desktop.act", version: "1.0.0" }],
      latest_review: {
        review_id: "11111111-1111-1111-1111-111111111111",
        target_type: "pairing",
        target_id: "1",
        reviewer_kind: "guardian",
        reviewer_id: "guardian-1",
        state: "running",
        reason: "The node exposes only the desktop capability and has a recent heartbeat.",
        risk_level: "high",
        risk_score: 84,
        evidence: null,
        decision_payload: null,
        created_at: "2026-01-01T00:00:01.000Z",
        started_at: "2026-01-01T00:00:01.000Z",
        completed_at: null,
      },
    } as const;

    const core = {
      pairingStore: {
        approve: vi.fn(),
        deny: vi.fn(),
        revoke: vi.fn(),
      },
      elevatedModeStore: createElevatedModeStore({
        tickIntervalMs: 0,
      }),
    } as unknown as OperatorCore;

    const { container, root } = renderIntoDocument(
      React.createElement(
        AdminAccessProvider,
        {
          core,
          mode: "desktop",
          adminAccessController: NOOP_ADMIN_ACCESS_CONTROLLER,
        },
        React.createElement(PendingPairingCard, {
          core,
          pairing,
          attachmentKind: "none",
        }),
      ),
    );

    try {
      const motivation = container.querySelector<HTMLDivElement>(
        '[data-testid="pairing-1-motivation"]',
      );
      expect(motivation).not.toBeNull();
      expect(motivation?.textContent).toContain("remote execution access");

      const review = container.querySelector<HTMLDivElement>('[data-testid="pairing-1-review"]');
      expect(review).not.toBeNull();
      expect(review?.textContent).toContain("recent heartbeat");
      expect(review?.textContent).toContain("Risk HIGH · score 84");
    } finally {
      cleanupTestRoot({ container, root });
    }
  });
});
