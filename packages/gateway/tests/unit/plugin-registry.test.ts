import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Logger } from "../../src/modules/observability/logger.js";
import { PluginRegistry } from "../../src/modules/plugins/registry.js";

function pluginManifestYaml(): string {
  return [
    "id: echo",
    "name: Echo",
    "version: 0.0.1",
    "entry: ./index.mjs",
    "contributes:",
    "  tools:",
    "    - plugin.echo.echo",
    "  commands:",
    "    - echo",
    "",
  ].join("\n");
}

function pluginEntryModule(): string {
  return `
export function registerPlugin() {
  return {
    tools: [
      {
        descriptor: {
          id: "plugin.echo.echo",
          description: "Echo back a string.",
          risk: "low",
          requires_confirmation: false,
          keywords: ["echo"],
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false
          }
        },
        execute: async (args) => {
          const text = args && typeof args === "object" && args.text ? String(args.text) : "";
          return { output: text };
        }
      }
    ],
    commands: [
      {
        name: "echo",
        execute: async (argv) => ({ output: argv.join(" ") })
      }
    ]
  };
}
`;
}

describe("PluginRegistry", () => {
  let home: string | undefined;

  afterEach(async () => {
    if (home) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  it("loads plugins from TYRUM_HOME/plugins and executes declared tools/commands", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    const listed = plugins.list();
    expect(listed.map((p) => p.id)).toEqual(["echo"]);

    const cmd = await plugins.tryExecuteCommand("/echo hello world");
    expect(cmd?.output).toBe("hello world");

    const tool = await plugins.executeTool({
      toolId: "plugin.echo.echo",
      args: { text: "hi" },
      home,
      agentId: "default",
      workspaceId: "default",
    });
    expect(tool?.output).toBe("hi");
    expect(tool?.error).toBeUndefined();
  });
});

