import { describe, expect, it } from "vitest";
import { getExecutionProfile } from "../../src/modules/agent/execution-profiles.js";
import { SANDBOX_TOOL_REGISTRY } from "../../src/modules/agent/tool-catalog-sandbox.js";
import { SANDBOX_TOOL_INPUT_SCHEMAS } from "../../src/modules/agent/tool-catalog-sandbox-schemas.js";
import type { ToolDescriptor } from "../../src/modules/agent/tools.js";

function toolEffect(id: string): "read_only" | "state_changing" | undefined {
  return SANDBOX_TOOL_REGISTRY.find((tool) => tool.id === id)?.effect;
}

describe("Sandbox tool metadata", () => {
  it("marks current as read-only and lease operations as state-changing", () => {
    expect(toolEffect("sandbox.current")).toBe("read_only");
    expect(toolEffect("sandbox.request")).toBe("state_changing");
    expect(toolEffect("sandbox.release")).toBe("state_changing");
    expect(toolEffect("sandbox.handoff")).toBe("state_changing");
  });

  it("keeps registry ids and schemas in exact sync", () => {
    expect(SANDBOX_TOOL_REGISTRY.map((tool) => tool.id).toSorted()).toEqual(
      Object.keys(SANDBOX_TOOL_INPUT_SCHEMAS).toSorted(),
    );
  });

  it("defines explicit object properties for every sandbox tool schema", () => {
    for (const tool of SANDBOX_TOOL_REGISTRY) {
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        properties: expect.any(Object),
        additionalProperties: false,
      } satisfies Partial<ToolDescriptor["inputSchema"]>);
    }
  });

  it("grants read-only helpers sandbox.current and writers sandbox.*", () => {
    expect(getExecutionProfile("explorer_ro").tool_allowlist).toContain("sandbox.current");
    expect(getExecutionProfile("reviewer_ro").tool_allowlist).toContain("sandbox.current");
    expect(getExecutionProfile("planner").tool_allowlist).toContain("sandbox.*");
    expect(getExecutionProfile("executor_rw").tool_allowlist).toContain("sandbox.*");
  });
});
