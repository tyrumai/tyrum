import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Logger } from "../../src/modules/observability/logger.js";
import { PluginRegistry } from "../../src/modules/plugins/registry.js";

function yamlStringList(indent: string, values: string[]): string[] {
  if (values.length === 0) {
    return [`${indent}[]`];
  }
  return values.map((value) => `${indent}- ${value}`);
}

function pluginManifestYaml(opts?: {
  includeContributes?: boolean;
  includePermissions?: boolean;
  tools?: string[];
  commands?: string[];
}): string {
  const includeContributes = opts?.includeContributes ?? true;
  const includePermissions = opts?.includePermissions ?? true;
  const tools = opts?.tools ?? ["plugin.echo.echo"];
  const commands = opts?.commands ?? ["echo"];

  const lines = [
    "id: echo",
    "name: Echo",
    "version: 0.0.1",
    "entry: ./index.mjs",
  ];

  if (includeContributes) {
    lines.push("contributes:");
    lines.push("  tools:");
    lines.push(...yamlStringList("    ", tools));
    lines.push("  commands:");
    lines.push(...yamlStringList("    ", commands));
    lines.push("  routes: []");
    lines.push("  mcp_servers: []");
  }

  if (includePermissions) {
    lines.push("permissions:");
    lines.push("  tools: []");
    lines.push("  network_egress: []");
    lines.push("  secrets: []");
    lines.push("  db: false");
  }

  lines.push("");
  return lines.join("\n");
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

  it("rejects plugins whose manifest omits required 'contributes' field", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml({ includeContributes: false }), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list()).toEqual([]);
    expect(await plugins.tryExecuteCommand("/echo hello")).toBeUndefined();
    expect(
      await plugins.executeTool({
        toolId: "plugin.echo.echo",
        args: { text: "hi" },
        home,
        agentId: "default",
        workspaceId: "default",
      }),
    ).toBeUndefined();
  });

  it("rejects plugins whose manifest omits required 'permissions' field", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml({ includePermissions: false }), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list()).toEqual([]);
    expect(await plugins.tryExecuteCommand("/echo hello")).toBeUndefined();
  });

  it("rejects plugins when runtime registration includes undeclared contributions", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.yml"),
      pluginManifestYaml({
        tools: [],
        commands: [],
      }),
      "utf-8",
    );
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list()).toEqual([]);
    expect(await plugins.tryExecuteCommand("/echo hello")).toBeUndefined();
    expect(
      await plugins.executeTool({
        toolId: "plugin.echo.echo",
        args: { text: "hi" },
        home,
        agentId: "default",
        workspaceId: "default",
      }),
    ).toBeUndefined();
  });
});
