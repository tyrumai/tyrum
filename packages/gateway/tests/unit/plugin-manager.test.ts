import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PluginManager } from "../../src/modules/plugins/manager.js";
import { ToolExecutor } from "../../src/modules/agent/tool-executor.js";
import { McpManager } from "../../src/modules/agent/mcp-manager.js";

describe("PluginManager (tools-only v1)", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it("loads plugin manifests and registers tool handlers", async () => {
    root = await mkdtemp(join(tmpdir(), "tyrum-plugins-"));
    const pluginsDir = join(root, "plugins");
    const pluginDir = join(pluginsDir, "echo");
    await mkdir(pluginDir, { recursive: true });

    await writeFile(
      join(pluginDir, "plugin.json"),
      JSON.stringify(
        {
          id: "echo",
          name: "Echo plugin",
          version: "0.1.0",
          entrypoint: "./index.mjs",
          permissions: ["tools"],
          tools: [
            {
              id: "tool.echo",
              description: "Echo a string",
              risk: "low",
              requires_confirmation: false,
              keywords: ["echo"],
              input_schema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
                additionalProperties: false,
              },
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    await writeFile(
      join(pluginDir, "index.mjs"),
      [
        "export const toolHandlers = {",
        "  'tool.echo': async (args) => {",
        "    const text = args && typeof args === 'object' ? args.text : '';",
        "    return { output: String(text ?? '') };",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf-8",
    );

    const manager = new PluginManager(pluginsDir, { enabled: true });
    await manager.load();

    expect(manager.isEnabled()).toBe(true);
    const plugins = manager.listPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0]!.loaded).toBe(true);
    expect(manager.getToolDescriptors().some((t) => t.id === "tool.echo")).toBe(true);
    expect(manager.getToolHandlers().has("tool.echo")).toBe(true);

    const executor = new ToolExecutor(
      root,
      new McpManager(),
      new Map(),
      fetch,
      undefined,
      undefined,
      undefined,
      undefined,
      manager.getToolHandlers(),
    );

    const res = await executor.execute("tool.echo", "tc-1", { text: "hi" });
    expect(res.error).toBeUndefined();
    expect(res.output).toBe("hi");
  });

  it("no-ops when disabled", async () => {
    root = await mkdtemp(join(tmpdir(), "tyrum-plugins-"));
    const pluginsDir = join(root, "plugins");
    await mkdir(pluginsDir, { recursive: true });

    const manager = new PluginManager(pluginsDir, { enabled: false });
    await manager.load();

    expect(manager.isEnabled()).toBe(false);
    expect(manager.listPlugins()).toHaveLength(0);
    expect(manager.getToolDescriptors()).toHaveLength(0);
  });
});

