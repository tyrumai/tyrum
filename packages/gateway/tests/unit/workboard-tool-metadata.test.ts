import { describe, expect, it } from "vitest";
import { getExecutionProfile } from "../../src/modules/agent/execution-profiles.js";
import { WORKBOARD_TOOL_REGISTRY } from "../../src/modules/agent/tool-catalog-workboard.js";

function toolRisk(id: string): "low" | "medium" | undefined {
  return WORKBOARD_TOOL_REGISTRY.find((tool) => tool.id === id)?.risk;
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
});
