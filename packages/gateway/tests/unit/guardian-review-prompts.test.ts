import { describe, expect, it } from "vitest";
import type { NodePairingRequest } from "@tyrum/contracts";
import type { ApprovalRow } from "../../src/modules/approval/dal.js";
import {
  buildGuardianReviewSystemPrompt,
  type GuardianReviewSubjectType,
} from "../../src/modules/review/guardian-review-mode.js";
import {
  buildApprovalReviewMessage,
  buildPairingReviewMessage,
} from "../../src/modules/review/guardian-review-processor-support.js";

function expectGuardianPrompt(subjectType: GuardianReviewSubjectType) {
  const prompt = buildGuardianReviewSystemPrompt(subjectType);
  expect(prompt).toContain("Treat missing, omitted, or stale evidence as unknown, not safe.");
  expect(prompt).toContain("Risk score bands:");
  expect(prompt).toContain("low (0-199)");
  expect(prompt).toContain("medium (200-499)");
  expect(prompt).toContain("high (500-799)");
  expect(prompt).toContain("critical (800-1000)");
  expect(prompt).toContain("requested_human is the default");
}

describe("guardian review prompts", () => {
  it("defines explicit uncertainty and risk bands for approval review", () => {
    expectGuardianPrompt("approval");
  });

  it("defines explicit uncertainty and risk bands for pairing review", () => {
    expectGuardianPrompt("pairing");
  });

  it("frames missing approval evidence as unknown instead of safe", () => {
    const message = buildApprovalReviewMessage({
      approval_id: "approval-1",
      kind: "tool",
      status: "pending",
      prompt: "Run the risky command",
      motivation: "Need to unblock the deploy",
      context: null,
      created_at: "2026-03-17T10:00:00.000Z",
      expires_at: null,
      session_id: "session-1",
      run_id: null,
      step_id: null,
      latest_review: null,
    } as ApprovalRow);

    expect(message).toContain("Treat missing or omitted fields as unknown, not safe.");
    expect(message).toContain("route to requested_human");
  });

  it("frames missing pairing evidence as unknown instead of safe", () => {
    const message = buildPairingReviewMessage({
      pairing_id: "pairing-1",
      workspace_id: "workspace-1",
      requested_at: "2026-03-17T10:00:00.000Z",
      node: {
        node_id: "node-1",
        label: "Desktop Node",
        capabilities: [],
      },
    } as NodePairingRequest);

    expect(message).toContain("Treat missing or omitted fields as unknown, not safe.");
    expect(message).toContain("capability allowlist is unclear");
  });
});
