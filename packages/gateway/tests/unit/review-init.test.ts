import { describe, expect, it } from "vitest";
import {
  approvalStatusForReviewMode,
  pairingStatusForReviewMode,
  resolveAutoReviewMode,
} from "../../src/modules/review/review-init.js";

describe("resolveAutoReviewMode", () => {
  it("defaults to auto_review when no policy service is configured", async () => {
    await expect(
      resolveAutoReviewMode({
        tenantId: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toBe("auto_review");
  });

  it("stays guardian-first when policy lookup fails", async () => {
    const policyService = {
      async loadEffectiveBundle() {
        throw new Error("policy backend unavailable");
      },
    };

    await expect(
      resolveAutoReviewMode({
        policyService: policyService as never,
        tenantId: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toBe("auto_review");
  });

  it("maps modes to the expected initial statuses", () => {
    expect(approvalStatusForReviewMode("auto_review")).toBe("queued");
    expect(approvalStatusForReviewMode("manual_only")).toBe("awaiting_human");
    expect(pairingStatusForReviewMode("auto_review")).toBe("queued");
    expect(pairingStatusForReviewMode("manual_only")).toBe("awaiting_human");
  });
});
