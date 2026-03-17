import { describe, expect, it } from "vitest";
import { SUBAGENT_TOOL_REGISTRY } from "../../src/modules/agent/tool-catalog-subagent.js";
import { SUBAGENT_TOOL_INPUT_SCHEMAS } from "../../src/modules/agent/tool-catalog-subagent-schemas.js";

function expectToolSchema(id: string): Record<string, unknown> {
  const schema = SUBAGENT_TOOL_REGISTRY.find((tool) => tool.id === id)?.inputSchema;
  expect(schema).toBeDefined();
  return schema as Record<string, unknown>;
}

describe("subagent tool metadata", () => {
  it("keeps registry ids and schema ids in sync", () => {
    expect(SUBAGENT_TOOL_REGISTRY.map((tool) => tool.id).toSorted()).toEqual(
      Object.keys(SUBAGENT_TOOL_INPUT_SCHEMAS).toSorted(),
    );
  });

  it("restricts helper spawning to read-only execution profiles", () => {
    expect(expectToolSchema("subagent.spawn")).toMatchObject({
      properties: {
        execution_profile: {
          type: "string",
          enum: ["explorer_ro", "reviewer_ro", "jury"],
        },
        message: { type: "string" },
      },
      required: ["execution_profile", "message"],
      additionalProperties: false,
    });
  });

  it("adds canonical guidance for the higher-risk subagent mutators", () => {
    expect(
      SUBAGENT_TOOL_REGISTRY.find((tool) => tool.id === "subagent.spawn")?.promptGuidance,
    ).toContain("Use spawn only for bounded helper work with a clear execution_profile.");
    expect(
      SUBAGENT_TOOL_REGISTRY.find((tool) => tool.id === "subagent.send")?.promptExamples,
    ).toContain(
      '{"subagent_id":"subagent_123","message":"Focus on the retry path and cite the relevant functions."}',
    );
    expect(
      SUBAGENT_TOOL_REGISTRY.find((tool) => tool.id === "subagent.close")?.promptGuidance,
    ).toContain("Close helpers once their result is integrated so session state stays clean.");
  });
});
