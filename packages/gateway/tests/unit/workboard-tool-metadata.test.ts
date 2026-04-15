import { describe, expect, it } from "vitest";
import { getExecutionProfile } from "../../src/modules/agent/execution-profiles.js";
import { WORKBOARD_TOOL_REGISTRY } from "../../src/modules/agent/tool-catalog-workboard.js";
import { WORKBOARD_TOOL_INPUT_SCHEMAS } from "../../src/modules/agent/tool-catalog-workboard-schemas.js";
import type { ToolDescriptor } from "../../src/modules/agent/tools.js";

function toolEffect(id: string): "read_only" | "state_changing" | undefined {
  return WORKBOARD_TOOL_REGISTRY.find((tool) => tool.id === id)?.effect;
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
  it("marks state-mutating workboard tools as state-changing", () => {
    expect(toolEffect("workboard.item.transition")).toBe("state_changing");
    expect(toolEffect("workboard.state.set")).toBe("state_changing");
    expect(toolEffect("workboard.clarification.request")).toBe("state_changing");
    expect(toolEffect("workboard.clarification.answer")).toBe("state_changing");
    expect(toolEffect("workboard.clarification.cancel")).toBe("state_changing");
  });

  it("keeps read-only workboard tools as read-only", () => {
    expect(toolEffect("workboard.item.list")).toBe("read_only");
    expect(toolEffect("workboard.state.get")).toBe("read_only");
    expect(toolEffect("workboard.clarification.list")).toBe("read_only");
  });

  it("does not expose workboard.subagent.* in the model-facing workboard registry", () => {
    expect(toolEffect("workboard.subagent.spawn")).toBeUndefined();
    expect(toolEffect("workboard.subagent.send")).toBeUndefined();
    expect(toolEffect("workboard.subagent.close")).toBeUndefined();
  });

  it("keeps interaction broad while explicitly denying workboard mutators", () => {
    const profile = getExecutionProfile("interaction");
    expect(profile.tool_allowlist).not.toContain("*");
    expect(profile.tool_allowlist).not.toContain("plugin.*");
    expect(profile.tool_allowlist).toContain("workboard.*");
    expect(profile.tool_denylist).toContain("workboard.item.update");
    expect(profile.tool_denylist).toContain("workboard.subagent.*");
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
  });

  it("adds prompt guidance for capture and clarification flows", () => {
    expect(
      WORKBOARD_TOOL_REGISTRY.find((tool) => tool.id === "workboard.capture")?.promptGuidance,
    ).toContain(
      "Use capture when the work is multi-step or should stay durable beyond the current reply.",
    );
    expect(
      WORKBOARD_TOOL_REGISTRY.find((tool) => tool.id === "workboard.clarification.request")
        ?.promptExamples,
    ).toContain(
      '{"work_item_id":"work_123","question":"Should heartbeat schedules notify operators by default or stay quiet?"}',
    );
  });
});
