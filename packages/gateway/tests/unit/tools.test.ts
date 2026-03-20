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

  it("excludes gateway-local fs and exec tools in shared mode", () => {
    const tools = selectToolDirectory(
      "read a file and run a command",
      ["read", "write", "bash", "webfetch"],
      [],
      8,
      "shared",
    );

    expect(tools.map((t) => t.id)).toEqual(["webfetch"]);
  });

  it("includes matching MCP tools regardless of effect classification", () => {
    const mcpTool: ToolDescriptor = {
      id: "mcp.calendar.list_events",
      description: "List calendar events",
      effect: "state_changing",
      keywords: ["calendar"],
      inputSchema: { type: "object" },
    };

    const selected = selectToolDirectory("calendar events", ["mcp.calendar.*"], [mcpTool], 8);
    expect(selected.map((t) => t.id)).toContain("mcp.calendar.list_events");
  });
});

describe("model tool naming", () => {
  it("applies the permissive object fallback when a tool omits inputSchema", () => {
    expect(
      validateToolDescriptorInputSchema({
        id: "plugin.echo.say",
        inputSchema: undefined,
      }),
    ).toEqual({
      ok: true,
      schema: {
        type: "object",
        additionalProperties: true,
      },
    });
  });

  it("normalizes top-level oneOf schemas into provider-safe object schemas", () => {
    expect(
      validateToolDescriptorInputSchema({
        id: "mcp.memory.write",
        inputSchema: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["fact", "note"] },
            key: { type: "string" },
            value: {},
            body_md: { type: "string" },
          },
          required: ["kind"],
          additionalProperties: false,
          oneOf: [
            {
              properties: {
                kind: { type: "string", enum: ["fact"] },
              },
              required: ["kind", "key", "value"],
            },
            {
              properties: {
                kind: { type: "string", enum: ["note"] },
              },
              required: ["kind", "body_md"],
            },
          ],
        },
      }),
    ).toEqual({
      ok: true,
      schema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["fact", "note"] },
          key: { type: "string" },
          value: {},
          body_md: { type: "string" },
        },
        required: ["kind"],
        additionalProperties: false,
      },
    });
  });

  it("preserves variant-only boolean property schemas while normalizing top-level oneOf", () => {
    expect(
      validateToolDescriptorInputSchema({
        id: "plugin.echo.boolean_variant_property",
        inputSchema: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["open", "closed"] },
          },
          required: ["mode"],
          oneOf: [
            {
              properties: {
                mode: { type: "string", enum: ["open"] },
                payload: true,
              },
              required: ["mode", "payload"],
            },
            {
              properties: {
                mode: { type: "string", enum: ["closed"] },
                payload: false,
              },
              required: ["mode"],
            },
          ],
        },
      }),
    ).toEqual({
      ok: true,
      schema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["open", "closed"] },
          payload: true,
        },
        required: ["mode"],
      },
    });
  });

  it("rejects top-level oneOf schemas that do not describe object variants", () => {
    expect(
      validateToolDescriptorInputSchema({
        id: "plugin.echo.bad_union",
        inputSchema: {
          type: "object",
          oneOf: [{ type: "string" }],
        },
      }),
    ).toEqual({
      ok: false,
      error:
        "plugin.echo.bad_union: input schema top-level 'oneOf' entries must describe object variants",
    });
  });

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

  it("includes the dedicated desktop tool family", () => {
    const builtinIds = listBuiltinToolDescriptors().map((tool) => tool.id);

    expect(builtinIds).toContain("tool.desktop.screenshot");
    expect(builtinIds).toContain("tool.desktop.snapshot");
    expect(builtinIds).toContain("tool.desktop.query");
    expect(builtinIds).toContain("tool.desktop.act");
    expect(builtinIds).toContain("tool.desktop.mouse");
    expect(builtinIds).toContain("tool.desktop.keyboard");
    expect(builtinIds).toContain("tool.desktop.wait-for");
  });

  it("includes distinct inspect and dispatch node tools", () => {
    const builtinIds = listBuiltinToolDescriptors().map((tool) => tool.id);

    expect(builtinIds).toContain("tool.node.inspect");
    expect(builtinIds).toContain("tool.node.dispatch");
    expect(builtinIds.filter((id) => id === "tool.node.dispatch")).toHaveLength(1);
    expect(builtinIds.filter((id) => id === "tool.node.inspect")).toHaveLength(1);
  });

  it("includes the location place tool family", () => {
    const builtinIds = listBuiltinToolDescriptors().map((tool) => tool.id);

    expect(builtinIds).toContain("tool.location.place.list");
    expect(builtinIds).toContain("tool.location.place.create");
    expect(builtinIds).toContain("tool.location.place.update");
    expect(builtinIds).toContain("tool.location.place.delete");
  });

  it("advertises nullable provider_place_id for location place updates", () => {
    const updateTool = listBuiltinToolDescriptors().find(
      (tool) => tool.id === "tool.location.place.update",
    );

    expect(updateTool?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        provider_place_id: {
          type: ["string", "null"],
        },
      },
    });
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
