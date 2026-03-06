import { describe, expect, it } from "vitest";
import {
  buildModelToolNameMap,
  registerModelTool,
  selectToolDirectory,
  type ToolDescriptor,
} from "../../src/modules/agent/tools.js";

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

describe("model tool naming", () => {
  it("sanitizes dotted tool ids for model-facing names", () => {
    const names = buildModelToolNameMap(["tool.fs.read", "plugin.echo.danger"]);

    expect(names.get("tool.fs.read")).toBe("tool_fs_read");
    expect(names.get("plugin.echo.danger")).toBe("plugin_echo_danger");
  });

  it("keeps canonical tool ids as non-enumerable aliases", () => {
    const names = buildModelToolNameMap(["tool.fs.read"]);
    const toolSet: Record<string, { id: string }> = {};
    const tool = { id: "tool.fs.read" };

    registerModelTool(toolSet, "tool.fs.read", tool, names);

    expect(Object.keys(toolSet)).toEqual(["tool_fs_read"]);
    expect(toolSet["tool_fs_read"]).toBe(tool);
    expect(toolSet["tool.fs.read"]).toBe(tool);
  });

  it("deduplicates model-facing names when sanitized ids would collide", () => {
    const names = buildModelToolNameMap(["tool.a.b", "tool_a_b"]);

    expect(names.get("tool.a.b")).toMatch(/^tool_a_b_/);
    expect(names.get("tool.a.b")).not.toBe("tool_a_b");
    expect(names.get("tool_a_b")).toBe("tool_a_b");
  });

  it("avoids colliding with another tool's canonical id", () => {
    const names = buildModelToolNameMap(["tool.fs.read", "tool_fs_read"]);
    const toolSet: Record<string, { id: string }> = {};
    const firstTool = { id: "tool.fs.read" };
    const secondTool = { id: "tool_fs_read" };
    const firstModelToolName = names.get("tool.fs.read");

    registerModelTool(toolSet, "tool.fs.read", firstTool, names);
    registerModelTool(toolSet, "tool_fs_read", secondTool, names);

    expect(firstModelToolName).toBeDefined();
    expect(Object.keys(toolSet)).toEqual([firstModelToolName, "tool_fs_read"]);
    expect(toolSet[firstModelToolName ?? ""]).toBe(firstTool);
    expect(toolSet["tool.fs.read"]).toBe(firstTool);
    expect(toolSet["tool_fs_read"]).toBe(secondTool);
  });

  it("throws when alias registration would overwrite another tool", () => {
    const toolSet: Record<string, { id: string }> = {
      tool_fs_read: { id: "existing" },
    };

    expect(() =>
      registerModelTool(
        toolSet,
        "tool_fs_read",
        { id: "tool_fs_read" },
        new Map([["tool_fs_read", "tool_fs_read_1234"]]),
      ),
    ).toThrow("model tool alias collision");
  });
});
