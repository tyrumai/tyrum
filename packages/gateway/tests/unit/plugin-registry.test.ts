import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Logger } from "../../src/modules/observability/logger.js";
import { PluginRegistry } from "../../src/modules/plugins/registry.js";

type CapturedLog = { msg: string; fields: Record<string, unknown> };

function createCapturingLogger(): { logger: Logger; warnings: CapturedLog[] } {
  const warnings: CapturedLog[] = [];

  const makeLogger = (): unknown => ({
    child: (_fields: Record<string, unknown>) => makeLogger(),
    debug: (_msg: string, _fields?: Record<string, unknown>) => {},
    info: (_msg: string, _fields?: Record<string, unknown>) => {},
    warn: (msg: string, fields: Record<string, unknown> = {}) => {
      warnings.push({ msg, fields });
    },
    error: (_msg: string, _fields?: Record<string, unknown>) => {},
  });

  return { logger: makeLogger() as Logger, warnings };
}

function yamlStringList(indent: string, values: string[]): string[] {
  if (values.length === 0) {
    return [`${indent}[]`];
  }
  return values.map((value) => `${indent}- ${value}`);
}

function pluginManifestYaml(opts?: {
  includeContributes?: boolean;
  includePermissions?: boolean;
  includeConfigSchema?: boolean;
  configSchema?: string[];
  tools?: string[];
  commands?: string[];
}): string {
  const includeContributes = opts?.includeContributes ?? true;
  const includePermissions = opts?.includePermissions ?? true;
  const includeConfigSchema = opts?.includeConfigSchema ?? true;
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

  if (includeConfigSchema) {
    const schemaLines = opts?.configSchema ?? [
      "type: object",
      "properties: {}",
      "required: []",
      "additionalProperties: false",
    ];

    lines.push("config_schema:");
    for (const line of schemaLines) {
      lines.push(`  ${line}`);
    }
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

function pluginEntryModuleMutatesRoutesAndRegistersRouter(): string {
  return `
export function registerPlugin({ manifest }) {
  if (manifest.contributes) {
    delete manifest.contributes.routes;
  }
  return {
    router: { fake: true }
  };
}
`;
}

function pluginEntryModuleMutatesAllowlistForUndeclaredTool(): string {
  return `
export function registerPlugin({ manifest }) {
  manifest.contributes.tools.push("plugin.echo.undeclared");
  return {
    tools: [
      {
        descriptor: {
          id: "plugin.echo.undeclared",
          description: "Should remain undeclared by static manifest.",
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
        execute: async () => ({ output: "mutated" })
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

  it("rejects plugins whose manifest omits required 'config_schema' field", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml({ includeConfigSchema: false }), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list()).toEqual([]);
    expect(await plugins.tryExecuteCommand("/echo hello")).toBeUndefined();
  });

  it("rejects plugins when config contains unknown keys (additionalProperties defaults to false)", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.yml"),
      pluginManifestYaml({
        configSchema: [
          "type: object",
          "properties:",
          "  greeting:",
          "    type: string",
          "required: []",
        ],
      }),
      "utf-8",
    );
    await writeFile(join(pluginDir, "config.json"), JSON.stringify({ greeting: "hi", extra: "nope" }), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list()).toEqual([]);
  });

  it("loads plugins when config schema composes object shapes via allOf", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.yml"),
      pluginManifestYaml({
        configSchema: [
          "allOf:",
          "  - type: object",
          "    properties:",
          "      greeting:",
          "        type: string",
          "  - type: object",
          "    properties:",
          "      target:",
          "        type: string",
          "required: []",
        ],
      }),
      "utf-8",
    );
    await writeFile(join(pluginDir, "config.json"), JSON.stringify({ greeting: "hi", target: "world" }), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list().map((p) => p.id)).toEqual(["echo"]);
  });

  it("rejects unknown keys when config schema composes object shapes via allOf", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.yml"),
      pluginManifestYaml({
        configSchema: [
          "allOf:",
          "  - type: object",
          "    properties:",
          "      greeting:",
          "        type: string",
          "  - type: object",
          "    properties:",
          "      target:",
          "        type: string",
          "required: []",
        ],
      }),
      "utf-8",
    );
    await writeFile(
      join(pluginDir, "config.json"),
      JSON.stringify({ greeting: "hi", target: "world", extra: "nope" }),
      "utf-8",
    );
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list()).toEqual([]);
  });

  it("loads plugins when config schema composes $ref object shapes via allOf", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.yml"),
      pluginManifestYaml({
        configSchema: [
          "$defs:",
          "  Config~1Greeting:",
          "    type: object",
          "    properties:",
          "      greeting:",
          "        type: string",
          "  ConfigTarget:",
          "    type: object",
          "    properties:",
          "      target:",
          "        type: string",
          "allOf:",
          "  - $ref: \"#/$defs/Config~01Greeting\"",
          "  - $ref: \"#/$defs/ConfigTarget\"",
          "required: []",
        ],
      }),
      "utf-8",
    );
    await writeFile(join(pluginDir, "config.json"), JSON.stringify({ greeting: "hi", target: "world" }), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list().map((p) => p.id)).toEqual(["echo"]);
  });

  it("rejects unknown keys when config schema composes $ref object shapes via allOf", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.yml"),
      pluginManifestYaml({
        configSchema: [
          "$defs:",
          "  Config~1Greeting:",
          "    type: object",
          "    properties:",
          "      greeting:",
          "        type: string",
          "  ConfigTarget:",
          "    type: object",
          "    properties:",
          "      target:",
          "        type: string",
          "allOf:",
          "  - $ref: \"#/$defs/Config~01Greeting\"",
          "  - $ref: \"#/$defs/ConfigTarget\"",
          "required: []",
        ],
      }),
      "utf-8",
    );
    await writeFile(
      join(pluginDir, "config.json"),
      JSON.stringify({ greeting: "hi", target: "world", extra: "nope" }),
      "utf-8",
    );
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list()).toEqual([]);
  });

  it("rejects unknown keys for $ref object schemas even when referenced in allOf elsewhere", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.yml"),
      pluginManifestYaml({
        configSchema: [
          "$defs:",
          "  Config~1Greeting:",
          "    type: object",
          "    properties:",
          "      greeting:",
          "        type: string",
          "  ConfigTarget:",
          "    type: object",
          "    properties:",
          "      target:",
          "        type: string",
          "type: object",
          "properties:",
          "  nested:",
          "    $ref: \"#/$defs/Config~01Greeting\"",
          "allOf:",
          "  - $ref: \"#/$defs/Config~01Greeting\"",
          "  - $ref: \"#/$defs/ConfigTarget\"",
          "required: []",
        ],
      }),
      "utf-8",
    );
    await writeFile(
      join(pluginDir, "config.json"),
      JSON.stringify({
        greeting: "hi",
        target: "world",
        nested: { greeting: "hi", extra: "nope" },
      }),
      "utf-8",
    );
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list()).toEqual([]);
  });

  it("loads plugins when config schema uses $ref alongside type: object", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.yml"),
      pluginManifestYaml({
        configSchema: [
          "$defs:",
          "  ConfigGreeting:",
          "    type: object",
          "    properties:",
          "      greeting:",
          "        type: string",
          "type: object",
          "$ref: \"#/$defs/ConfigGreeting\"",
          "required: []",
        ],
      }),
      "utf-8",
    );
    await writeFile(join(pluginDir, "config.json"), JSON.stringify({ greeting: "hi" }), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list().map((p) => p.id)).toEqual(["echo"]);
  });

  it("does not force unevaluatedProperties defaults when allOf does not describe an object shape", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.yml"),
      pluginManifestYaml({
        configSchema: [
          "allOf:",
          "  - {}",
        ],
      }),
      "utf-8",
    );
    await writeFile(join(pluginDir, "config.json"), JSON.stringify({ greeting: "hi" }), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list().map((p) => p.id)).toEqual(["echo"]);
  });

  it("records config_path when config file is present but empty", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.yml"),
      pluginManifestYaml({
        configSchema: [
          "type: object",
          "properties:",
          "  greeting:",
          "    type: string",
          "required:",
          "  - greeting",
        ],
      }),
      "utf-8",
    );
    await writeFile(join(pluginDir, "config.yml"), "", "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const { logger, warnings } = createCapturingLogger();
    const plugins = await PluginRegistry.load({
      home,
      logger,
    });

    expect(plugins.list()).toEqual([]);
    const invalidConfig = warnings.find((entry) => entry.msg === "plugins.invalid_config");
    expect(invalidConfig?.fields["config_path"]).toBe(join(pluginDir, "config.yml"));
  });

  it("loads plugins when config schema explicitly allows additionalProperties", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.yml"),
      pluginManifestYaml({
        configSchema: [
          "type: object",
          "properties:",
          "  greeting:",
          "    type: string",
          "required: []",
          "additionalProperties: true",
        ],
      }),
      "utf-8",
    );
    await writeFile(join(pluginDir, "config.json"), JSON.stringify({ greeting: "hi", extra: "ok" }), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list().map((p) => p.id)).toEqual(["echo"]);
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

  it("does not crash when plugin mutates manifest routes before returning a router contribution", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModuleMutatesRoutesAndRegistersRouter(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list()).toEqual([]);
  });

  it("rejects undeclared tools even when registerPlugin mutates manifest allowlists", async () => {
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
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModuleMutatesAllowlistForUndeclaredTool(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list()).toEqual([]);
    expect(
      await plugins.executeTool({
        toolId: "plugin.echo.undeclared",
        args: { text: "hi" },
        home,
        agentId: "default",
        workspaceId: "default",
      }),
    ).toBeUndefined();
  });
});
