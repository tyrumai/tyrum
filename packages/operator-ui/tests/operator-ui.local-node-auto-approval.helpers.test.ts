import { describe, expect, it } from "vitest";
import type { PairingGetResponse } from "@tyrum/operator-core/browser";
import {
  extractLatestTerminalReviewState,
  isBenignAutoApprovalRace,
} from "../src/local-node-auto-approval.js";
import { samplePairingRequestPending } from "./operator-ui.test-fixtures.js";

type PairingReview = NonNullable<PairingGetResponse["pairing"]["reviews"]>[number];

function createReview(
  state: PairingReview["state"],
  createdAt: string,
  reviewId = `${state}-${createdAt}`,
): PairingReview {
  return {
    review_id: reviewId,
    target_type: "pairing",
    target_id: "1",
    reviewer_kind: state === "requested_human" ? "system" : "human",
    reviewer_id: null,
    state,
    reason: state,
    risk_level: null,
    risk_score: null,
    evidence: null,
    decision_payload: null,
    created_at: createdAt,
    started_at: createdAt,
    completed_at: state === "requested_human" ? null : createdAt,
  };
}

function createPairing(input?: {
  pairingId?: number;
  nodeId?: string;
  requestedAt?: string;
  status?: PairingGetResponse["pairing"]["status"];
  latestReview?: PairingGetResponse["pairing"]["latest_review"];
  reviews?: PairingReview[];
}): PairingGetResponse["pairing"] {
  const pairing = samplePairingRequestPending();
  return {
    ...pairing,
    pairing_id: input?.pairingId ?? pairing.pairing_id,
    requested_at: input?.requestedAt ?? pairing.requested_at,
    status: input?.status ?? pairing.status,
    node: {
      ...pairing.node,
      node_id: input?.nodeId ?? pairing.node.node_id,
    },
    latest_review: input?.latestReview ?? pairing.latest_review,
    ...(input?.reviews ? { reviews: input.reviews } : {}),
  };
}

describe("local node auto approval helpers", () => {
  it("treats a later terminal approval as the active review state", () => {
    const pendingReview = createReview("requested_human", "2026-01-01T00:00:03.000Z", "pending-1");
    const pairing = createPairing({
      latestReview: pendingReview,
      reviews: [
        createReview("denied", "2026-01-01T00:00:01.000Z", "denied-1"),
        createReview("approved", "2026-01-01T00:00:02.000Z", "approved-1"),
        pendingReview,
      ],
    });

    expect(extractLatestTerminalReviewState(pairing)).toBe("approved");
  });

  it("marks reviewing responses as benign races", () => {
    const pairing = createPairing({
      pairingId: 8,
      requestedAt: "2026-01-01T00:00:00.000Z",
      status: "reviewing",
    });

    expect(
      isBenignAutoApprovalRace(
        { pairingStore: { getSnapshot: () => ({ byId: { 8: pairing } }) } },
        8,
        "8:2026-01-01T00:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("does not mark matching actionable pairings as benign races", () => {
    const pairing = createPairing({
      pairingId: 9,
      requestedAt: "2026-01-01T00:00:00.000Z",
      status: "awaiting_human",
    });

    expect(
      isBenignAutoApprovalRace(
        { pairingStore: { getSnapshot: () => ({ byId: { 9: pairing } }) } },
        9,
        "9:2026-01-01T00:00:00.000Z",
      ),
    ).toBe(false);
  });
});
