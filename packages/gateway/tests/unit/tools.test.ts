import { describe, expect, it } from "vitest";
import { selectToolDirectory, type ToolDescriptor } from "../../src/modules/agent/tools.js";

describe("selectToolDirectory", () => {
  it("includes confirmation-required tools by default", () => {
    const tools = selectToolDirectory("run shell command", ["tool.exec", "tool.fs.read"], []);

    expect(tools.map((t) => t.id)).toContain("tool.fs.read");
    expect(tools.map((t) => t.id)).toContain("tool.exec");
  });

  it("can exclude confirmation-required tools when explicitly disabled", () => {
    const tools = selectToolDirectory("run shell command", ["tool.exec"], [], 8, false);

    expect(tools.map((t) => t.id)).not.toContain("tool.exec");
  });

  it("applies confirmation filtering to MCP tools", () => {
    const mcpTool: ToolDescriptor = {
      id: "mcp.calendar.list_events",
      description: "List calendar events",
      risk: "medium",
      requires_confirmation: true,
      keywords: ["calendar"],
      inputSchema: { type: "object" },
    };

    const filtered = selectToolDirectory(
      "calendar events",
      ["mcp.calendar.*"],
      [mcpTool],
      8,
      false,
    );
    expect(filtered.map((t) => t.id)).not.toContain("mcp.calendar.list_events");

    const allowed = selectToolDirectory("calendar events", ["mcp.calendar.*"], [mcpTool], 8, true);
    expect(allowed.map((t) => t.id)).toContain("mcp.calendar.list_events");
  });
});
