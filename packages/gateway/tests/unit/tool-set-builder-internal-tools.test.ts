import { describe, expect, it } from "vitest";
import { createGuardianReviewDecisionCollector } from "../../src/modules/review/guardian-review-mode.js";
import { createGuardianReviewDecisionTool } from "../../src/modules/agent/runtime/tool-set-builder-internal-tools.js";

describe("createGuardianReviewDecisionTool", () => {
  it("registers a concrete object-root input schema with validation", async () => {
    const tool = createGuardianReviewDecisionTool(
      createGuardianReviewDecisionCollector("approval"),
    );

    expect(tool.inputSchema.jsonSchema).toMatchObject({
      type: "object",
      required: ["decision", "reason", "risk_level", "risk_score"],
      additionalProperties: false,
      properties: expect.objectContaining({
        decision: expect.objectContaining({
          type: "string",
        }),
        reason: expect.objectContaining({
          type: "string",
        }),
        risk_level: expect.objectContaining({
          type: "string",
        }),
        risk_score: expect.objectContaining({
          type: "number",
        }),
      }),
    });

    await expect(
      tool.inputSchema.validate?.({
        decision: "approve",
        reason: "Looks safe.",
        risk_level: "low",
        risk_score: 4,
      }),
    ).resolves.toMatchObject({
      success: true,
      value: {
        decision: "approve",
        reason: "Looks safe.",
        risk_level: "low",
        risk_score: 4,
      },
    });
  });
});
