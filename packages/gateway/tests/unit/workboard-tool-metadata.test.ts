import { describe, expect, it } from "vitest";
import { getExecutionProfile } from "../../src/modules/agent/execution-profiles.js";
import { WORKBOARD_TOOL_REGISTRY } from "../../src/modules/agent/tool-catalog-workboard.js";
import { WORKBOARD_TOOL_INPUT_SCHEMAS } from "../../src/modules/agent/tool-catalog-workboard-schemas.js";
import type { ToolDescriptor } from "../../src/modules/agent/tools.js";

function toolRisk(id: string): "low" | "medium" | undefined {
  return WORKBOARD_TOOL_REGISTRY.find((tool) => tool.id === id)?.risk;
}

function toolSchema(id: string): Record<string, unknown> | undefined {
  return WORKBOARD_TOOL_REGISTRY.find((tool) => tool.id === id)?.inputSchema;
}

function expectToolSchema(id: string): Record<string, unknown> {
  const schema = toolSchema(id);
  expect(schema).toBeDefined();
  return schema as Record<string, unknown>;
}

describe("WorkBoard tool metadata", () => {
  it("marks state-mutating workboard tools as medium risk", () => {
    expect(toolRisk("workboard.item.transition")).toBe("medium");
    expect(toolRisk("workboard.state.set")).toBe("medium");
    expect(toolRisk("workboard.subagent.send")).toBe("medium");
    expect(toolRisk("workboard.subagent.close")).toBe("medium");
    expect(toolRisk("workboard.clarification.request")).toBe("medium");
    expect(toolRisk("workboard.clarification.answer")).toBe("medium");
    expect(toolRisk("workboard.clarification.cancel")).toBe("medium");
  });

  it("keeps read-only workboard tools as low risk", () => {
    expect(toolRisk("workboard.item.list")).toBe("low");
    expect(toolRisk("workboard.state.get")).toBe("low");
    expect(toolRisk("workboard.clarification.list")).toBe("low");
  });

  it("keeps the interaction profile wildcard allowlist minimal", () => {
    expect(getExecutionProfile("interaction").tool_allowlist).toEqual(["*"]);
  });

  it("keeps registry ids and explicit schema ids in exact sync", () => {
    expect(WORKBOARD_TOOL_REGISTRY.map((tool) => tool.id).toSorted()).toEqual(
      Object.keys(WORKBOARD_TOOL_INPUT_SCHEMAS).toSorted(),
    );
  });

  it("defines explicit object properties for every workboard tool schema", () => {
    for (const tool of WORKBOARD_TOOL_REGISTRY) {
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        properties: expect.any(Object),
        additionalProperties: false,
      } satisfies Partial<ToolDescriptor["inputSchema"]>);
    }
  });

  it("keeps representative workboard schemas aligned with executor inputs", () => {
    expect(expectToolSchema("workboard.artifact.get")).toMatchObject({
      properties: {
        artifact_id: { type: "string" },
      },
      required: ["artifact_id"],
      additionalProperties: false,
    });
    expect(expectToolSchema("workboard.item.transition")).toMatchObject({
      properties: {
        work_item_id: { type: "string" },
        status: {
          type: "string",
          enum: ["backlog", "ready", "blocked", "done", "failed", "cancelled"],
        },
      },
      required: ["work_item_id", "status"],
    });
    expect(expectToolSchema("workboard.state.set")).toMatchObject({
      properties: {
        key: { type: "string" },
        scope_kind: { type: "string", enum: ["agent", "work_item"] },
        work_item_id: { type: "string" },
        value_json: expect.any(Object),
        provenance_json: expect.any(Object),
      },
      required: ["key"],
    });
    expect(expectToolSchema("workboard.subagent.spawn")).toMatchObject({
      properties: {
        message: { type: "string" },
        execution_profile: { type: "string" },
        work_item_id: { type: "string" },
        work_item_task_id: { type: "string" },
      },
      required: ["message", "execution_profile"],
    });
  });
});
