import { describe, expect, it } from "vitest";
import { buildStatusDetails } from "../../src/modules/observability/status-details.js";

describe("status details sandbox summary", () => {
  it("derives elevated execution availability when tools arrays are missing", async () => {
    const details = await buildStatusDetails({
      policyService: {
        getStatus: async () => ({
          enabled: true,
          observe_only: false,
          effective_sha256: "policy-sha",
          sources: { deployment: "default", agent: null },
        }),
        loadEffectiveBundle: async () => ({
          bundle: {
            v: 1,
            tools: {
              default: "allow",
            },
          },
          sha256: "policy-sha",
          sources: { deployment: "default", agent: null, playbook: null },
        }),
      } as unknown as import("../../src/modules/policy/service.js").PolicyService,
    });

    expect(details.sandbox).not.toBeNull();
    expect(details.sandbox?.mode).toBe("enforce");
    expect(details.sandbox?.elevated_execution_available).toBe(true);
  });
});
