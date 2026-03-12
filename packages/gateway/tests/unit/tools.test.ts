import { describe, expect, it } from "vitest";
import {
  buildModelToolNameMap,
  listBuiltinToolDescriptors,
  registerModelTool,
  selectToolDirectory,
  type ToolDescriptor,
} from "../../src/modules/agent/tools.js";
import { validateToolDescriptorInputSchema } from "../../src/modules/agent/tool-schema.js";

describe("selectToolDirectory", () => {
  it("includes confirmation-required tools by default", () => {
    const tools = selectToolDirectory("run shell command", ["bash", "read"], []);

    expect(tools.map((t) => t.id)).toContain("read");
    expect(tools.map((t) => t.id)).toContain("bash");
  });

  it("can exclude confirmation-required tools when explicitly disabled", () => {
    const tools = selectToolDirectory("run shell command", ["bash"], [], 8, false);

    expect(tools.map((t) => t.id)).not.toContain("bash");
  });

  it("excludes gateway-local fs and exec tools in shared mode", () => {
    const tools = selectToolDirectory(
      "read a file and run a command",
      ["read", "write", "bash", "webfetch"],
      [],
      8,
      true,
      "shared",
    );

    expect(tools.map((t) => t.id)).toEqual(["webfetch"]);
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
    const names = buildModelToolNameMap(["mcp.calendar.events_list", "plugin.echo.danger"]);

    expect(names.get("mcp.calendar.events_list")).toBe("mcp_calendar_events_list");
    expect(names.get("plugin.echo.danger")).toBe("plugin_echo_danger");
  });

  it("keeps canonical tool ids as non-enumerable aliases", () => {
    const names = buildModelToolNameMap(["read"]);
    const toolSet: Record<string, { id: string }> = {};
    const tool = { id: "read" };

    registerModelTool(toolSet, "read", tool, names);

    expect(Object.keys(toolSet)).toEqual(["read"]);
    expect(toolSet["read"]).toBe(tool);
    expect(toolSet["read"]).toBe(tool);
  });

  it("deduplicates model-facing names when sanitized ids would collide", () => {
    const names = buildModelToolNameMap(["tool.a.b", "tool_a_b"]);

    expect(names.get("tool.a.b")).toMatch(/^tool_a_b_/);
    expect(names.get("tool.a.b")).not.toBe("tool_a_b");
    expect(names.get("tool_a_b")).toBe("tool_a_b");
  });

  it("avoids colliding with another tool's canonical id", () => {
    const names = buildModelToolNameMap(["read", "tool_fs_read"]);
    const toolSet: Record<string, { id: string }> = {};
    const firstTool = { id: "read" };
    const secondTool = { id: "tool_fs_read" };
    const firstModelToolName = names.get("read");

    registerModelTool(toolSet, "read", firstTool, names);
    registerModelTool(toolSet, "tool_fs_read", secondTool, names);

    expect(firstModelToolName).toBeDefined();
    expect(Object.keys(toolSet)).toEqual([firstModelToolName, "tool_fs_read"]);
    expect(toolSet[firstModelToolName ?? ""]).toBe(firstTool);
    expect(toolSet["read"]).toBe(firstTool);
    expect(toolSet["tool_fs_read"]).toBe(secondTool);
  });

  it("includes distinct inspect and dispatch node tools", () => {
    const builtinIds = listBuiltinToolDescriptors().map((tool) => tool.id);

    expect(builtinIds).toContain("tool.node.inspect");
    expect(builtinIds).toContain("tool.node.dispatch");
    expect(builtinIds.filter((id) => id === "tool.node.dispatch")).toHaveLength(1);
    expect(builtinIds.filter((id) => id === "tool.node.inspect")).toHaveLength(1);
  });

  it("publishes object-root input schemas for all builtin model tools", () => {
    const invalid = listBuiltinToolDescriptors()
      .map((tool) => ({ tool, validation: validateToolDescriptorInputSchema(tool) }))
      .filter((entry) => !entry.validation.ok);

    expect(invalid).toEqual([]);
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
