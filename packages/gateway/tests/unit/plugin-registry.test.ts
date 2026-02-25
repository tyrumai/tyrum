import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContainer } from "../../src/container.js";
import { Logger } from "../../src/modules/observability/logger.js";
import { PluginRegistry } from "../../src/modules/plugins/registry.js";
import { SQLITE_MIGRATIONS_DIR } from "../helpers/sqlite-db.js";

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
  entry?: string;
}): string {
  const includeContributes = opts?.includeContributes ?? true;
  const includePermissions = opts?.includePermissions ?? true;
  const includeConfigSchema = opts?.includeConfigSchema ?? true;
  const tools = opts?.tools ?? ["plugin.echo.echo"];
  const commands = opts?.commands ?? ["echo"];
  const entry = opts?.entry ?? "./index.mjs";

  const lines = ["id: echo", "name: Echo", "version: 0.0.1", `entry: ${entry}`];

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

function pluginIntegritySha256Hex(manifestRaw: string, entryRaw: string): string {
  return createHash("sha256")
    .update("manifest\0")
    .update(manifestRaw)
    .update("\0entry\0")
    .update(entryRaw)
    .digest("hex");
}

function pluginLockJson(opts: { pinnedVersion: string; integritySha256: string }): string {
  return JSON.stringify(
    {
      format: "tyrum.plugin.lock.v1",
      recorded_at: new Date().toISOString(),
      source: { kind: "local", spec: "test" },
      pinned_version: opts.pinnedVersion,
      integrity_sha256: opts.integritySha256,
    },
    null,
    2,
  );
}

describe("PluginRegistry", () => {
  let home: string | undefined;
  const isPosix = process.platform !== "win32" && typeof process.getuid === "function";
  const itPosix = isPosix ? it : it.skip;

  afterEach(async () => {
    vi.restoreAllMocks();
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

  it("emits plugin.lifecycle loaded events with durable audit linkage", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const container = createContainer({
      dbPath: ":memory:",
      migrationsDir: SQLITE_MIGRATIONS_DIR,
      tyrumHome: home,
    });

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
      container,
    });

    expect(plugins.list().map((p) => p.id)).toEqual(["echo"]);

    const outboxRows = await container.db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ? ORDER BY id ASC",
      ["ws.broadcast"],
    );
    const lifecycleEvents = outboxRows
      .map(
        (row) => JSON.parse(row.payload_json) as { message?: { type?: string; payload?: unknown } },
      )
      .map((row) => row.message)
      .filter((msg): msg is { type: string; payload: any } =>
        Boolean(msg && typeof msg.type === "string"),
      );

    const loaded = lifecycleEvents.find((evt) => evt.type === "plugin.lifecycle");
    expect(loaded).toBeTruthy();
    expect(loaded?.payload?.kind).toBe("loaded");
    expect(loaded?.payload?.plugin?.id).toBe("echo");

    const audit = loaded?.payload?.audit as
      | { plan_id: string; step_index: number; event_id: number }
      | undefined;
    expect(audit?.plan_id).toBe("gateway.plugins.lifecycle");

    const auditRow = await container.db.get<{
      id: number;
      plan_id: string;
      step_index: number;
      action: string;
      prev_hash: string | null;
      event_hash: string | null;
    }>(
      "SELECT id, plan_id, step_index, action, prev_hash, event_hash FROM planner_events WHERE id = ?",
      [audit?.event_id ?? -1],
    );
    expect(auditRow?.plan_id).toBe(audit?.plan_id);
    expect(auditRow?.step_index).toBe(audit?.step_index);
    expect(auditRow?.event_hash).toMatch(/^[0-9a-f]{64}$/i);
    const action = auditRow ? (JSON.parse(auditRow.action) as any) : undefined;
    expect(action?.type).toBe("plugin.lifecycle");
    expect(action?.kind).toBe("loaded");
    expect(action?.plugin_id).toBe("echo");

    await container.db.close();
  });

  it("emits plugin.lifecycle failed events with durable audit linkage", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "config.yml"), "unexpected: true\n", "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const container = createContainer({
      dbPath: ":memory:",
      migrationsDir: SQLITE_MIGRATIONS_DIR,
      tyrumHome: home,
    });

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
      container,
    });

    expect(plugins.list()).toHaveLength(0);

    const outboxRows = await container.db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ? ORDER BY id ASC",
      ["ws.broadcast"],
    );
    const lifecycleEvents = outboxRows
      .map(
        (row) => JSON.parse(row.payload_json) as { message?: { type?: string; payload?: unknown } },
      )
      .map((row) => row.message)
      .filter((msg): msg is { type: string; payload: any } =>
        Boolean(msg && typeof msg.type === "string"),
      );

    const failed = lifecycleEvents.find(
      (evt) => evt.type === "plugin.lifecycle" && evt.payload?.kind === "failed",
    );
    expect(failed).toBeTruthy();
    expect(failed?.payload?.plugin?.id).toBe("echo");
    expect(failed?.payload?.reason).toBe("invalid_config");

    const audit = failed?.payload?.audit as
      | { plan_id: string; step_index: number; event_id: number }
      | undefined;
    expect(audit?.plan_id).toBe("gateway.plugins.lifecycle");

    const auditRow = await container.db.get<{
      id: number;
      action: string;
    }>("SELECT id, action FROM planner_events WHERE id = ?", [audit?.event_id ?? -1]);
    const action = auditRow ? (JSON.parse(auditRow.action) as any) : undefined;
    expect(action?.type).toBe("plugin.lifecycle");
    expect(action?.kind).toBe("failed");
    expect(action?.plugin_id).toBe("echo");
    expect(action?.reason).toBe("invalid_config");

    await container.db.close();
  });

  it("emits plugin_tool.invoked events with durable audit linkage", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const container = createContainer({
      dbPath: ":memory:",
      migrationsDir: SQLITE_MIGRATIONS_DIR,
      tyrumHome: home,
    });

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
      container,
    });

    const outboxBefore = await container.db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );

    const toolRes = await plugins.executeTool({
      toolId: "plugin.echo.echo",
      toolCallId: "call-1",
      args: { text: "hi" },
      home,
      agentId: "default",
      workspaceId: "default",
      auditPlanId: "agent-turn-test",
      sessionId: "session-1",
      channel: "local",
      threadId: "thread-1",
      policySnapshotId: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(toolRes?.output).toBe("hi");

    const outboxAfter = await container.db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    expect(outboxAfter?.count).toBe((outboxBefore?.count ?? 0) + 1);

    const lastOutbox = await container.db.get<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ? ORDER BY id DESC LIMIT 1",
      ["ws.broadcast"],
    );
    const msg = lastOutbox
      ? (JSON.parse(lastOutbox.payload_json) as { message?: any }).message
      : undefined;
    expect(msg?.type).toBe("plugin_tool.invoked");
    expect(msg?.payload?.plugin_id).toBe("echo");
    expect(msg?.payload?.tool_id).toBe("plugin.echo.echo");
    expect(msg?.payload?.tool_call_id).toBe("call-1");
    expect(msg?.payload?.policy_snapshot_id).toBe("550e8400-e29b-41d4-a716-446655440000");

    const audit = msg?.payload?.audit as
      | { plan_id: string; step_index: number; event_id: number }
      | undefined;
    expect(audit?.plan_id).toBe("gateway.plugins.tool_invoked:agent-turn-test");

    const auditRow = await container.db.get<{
      id: number;
      plan_id: string;
      step_index: number;
      action: string;
    }>("SELECT id, plan_id, step_index, action FROM planner_events WHERE id = ?", [
      audit?.event_id ?? -1,
    ]);
    expect(auditRow?.plan_id).toBe(audit?.plan_id);
    expect(auditRow?.step_index).toBe(audit?.step_index);
    const action = auditRow ? (JSON.parse(auditRow.action) as any) : undefined;
    expect(action?.type).toBe("plugin_tool.invoked");
    expect(action?.tool_id).toBe("plugin.echo.echo");
    expect(action?.tool_call_id).toBe("call-1");
    expect(action?.plugin_id).toBe("echo");

    await container.db.close();
  });

  it("does not steal step indices from planner append on shared plans", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const container = createContainer({
      dbPath: ":memory:",
      migrationsDir: SQLITE_MIGRATIONS_DIR,
      tyrumHome: home,
    });

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
      container,
    });

    await plugins.executeTool({
      toolId: "plugin.echo.echo",
      toolCallId: "call-1",
      args: { text: "hi" },
      home,
      agentId: "default",
      workspaceId: "default",
      auditPlanId: "agent-turn-test",
    });

    const plannerAppend = await container.eventLog.append({
      replayId: "planner-replay-1",
      planId: "agent-turn-test",
      stepIndex: 0,
      occurredAt: new Date().toISOString(),
      action: { type: "planner.step" },
    });
    expect(plannerAppend.kind).toBe("inserted");

    await container.db.close();
  });

  it("does not persist tool audit records when outbox insert fails", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const container = createContainer({
      dbPath: ":memory:",
      migrationsDir: SQLITE_MIGRATIONS_DIR,
      tyrumHome: home,
    });

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
      container,
    });

    await container.db.exec("DROP TABLE outbox");

    const auditBefore = await container.db.all<{ action: string }>(
      "SELECT action FROM planner_events",
    );
    const invokedBefore = auditBefore.filter((row) => {
      try {
        return (JSON.parse(row.action) as { type?: unknown }).type === "plugin_tool.invoked";
      } catch {
        return false;
      }
    });
    expect(invokedBefore.length).toBe(0);

    const toolRes = await plugins.executeTool({
      toolId: "plugin.echo.echo",
      toolCallId: "call-1",
      args: { text: "hi" },
      home,
      agentId: "default",
      workspaceId: "default",
      auditPlanId: "agent-turn-test",
    });
    expect(toolRes?.output).toBe("hi");

    const auditAfter = await container.db.all<{ action: string }>(
      "SELECT action FROM planner_events",
    );
    const invokedAfter = auditAfter.filter((row) => {
      try {
        return (JSON.parse(row.action) as { type?: unknown }).type === "plugin_tool.invoked";
      } catch {
        return false;
      }
    });
    expect(invokedAfter.length).toBe(0);

    await container.db.close();
  });

  it("logs a warning when plugin tool audit emission fails", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const container = createContainer({
      dbPath: ":memory:",
      migrationsDir: SQLITE_MIGRATIONS_DIR,
      tyrumHome: home,
    });

    const { logger, warnings } = createCapturingLogger();
    const plugins = await PluginRegistry.load({
      home,
      logger,
      container,
    });

    const originalAppendNext = container.eventLog.appendNext.bind(container.eventLog);
    container.eventLog.appendNext = async () => {
      throw new Error("simulated audit failure");
    };

    const toolRes = await plugins.executeTool({
      toolId: "plugin.echo.echo",
      toolCallId: "call-1",
      args: { text: "hi" },
      home,
      agentId: "default",
      workspaceId: "default",
      auditPlanId: "agent-turn-test",
    });
    expect(toolRes?.output).toBe("hi");

    container.eventLog.appendNext = originalAppendNext;

    expect(warnings.some((entry) => entry.msg === "plugins.tool_invoked_emit_failed")).toBe(true);

    await container.db.close();
  });

  it("rejects plugins whose manifest omits required 'contributes' field", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.yml"),
      pluginManifestYaml({ includeContributes: false }),
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

  it("rejects plugins whose manifest omits required 'permissions' field", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.yml"),
      pluginManifestYaml({ includePermissions: false }),
      "utf-8",
    );
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
    await writeFile(
      join(pluginDir, "plugin.yml"),
      pluginManifestYaml({ includeConfigSchema: false }),
      "utf-8",
    );
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
    await writeFile(
      join(pluginDir, "config.json"),
      JSON.stringify({ greeting: "hi", extra: "nope" }),
      "utf-8",
    );
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
    await writeFile(
      join(pluginDir, "config.json"),
      JSON.stringify({ greeting: "hi", target: "world" }),
      "utf-8",
    );
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
          '  - $ref: "#/$defs/Config~01Greeting"',
          '  - $ref: "#/$defs/ConfigTarget"',
          "required: []",
        ],
      }),
      "utf-8",
    );
    await writeFile(
      join(pluginDir, "config.json"),
      JSON.stringify({ greeting: "hi", target: "world" }),
      "utf-8",
    );
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
          '  - $ref: "#/$defs/Config~01Greeting"',
          '  - $ref: "#/$defs/ConfigTarget"',
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
          '    $ref: "#/$defs/Config~01Greeting"',
          "allOf:",
          '  - $ref: "#/$defs/Config~01Greeting"',
          '  - $ref: "#/$defs/ConfigTarget"',
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
          '$ref: "#/$defs/ConfigGreeting"',
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

  it("loads plugins when config schema uses $ref alongside inline properties", async () => {
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
          "properties:",
          "  target:",
          "    type: string",
          '$ref: "#/$defs/ConfigGreeting"',
          "required: []",
        ],
      }),
      "utf-8",
    );
    await writeFile(
      join(pluginDir, "config.json"),
      JSON.stringify({ greeting: "hi", target: "world" }),
      "utf-8",
    );
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list().map((p) => p.id)).toEqual(["echo"]);
  });

  it("does not allow __proto__ keys to pollute normalized config_schema", async () => {
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
          "  __proto__:",
          "    polluted: true",
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
    const manifest = plugins.getManifest("echo");
    expect(manifest).toBeDefined();
    const schema = (manifest as { config_schema: Record<string, unknown> }).config_schema;
    const props = schema["properties"] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(props, "__proto__")).toBe(true);
    expect((props as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("does not force unevaluatedProperties defaults when allOf does not describe an object shape", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.yml"),
      pluginManifestYaml({
        configSchema: ["allOf:", "  - {}"],
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
    await writeFile(
      join(pluginDir, "config.json"),
      JSON.stringify({ greeting: "hi", extra: "ok" }),
      "utf-8",
    );
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
    await writeFile(
      join(pluginDir, "index.mjs"),
      pluginEntryModuleMutatesRoutesAndRegistersRouter(),
      "utf-8",
    );

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
    await writeFile(
      join(pluginDir, "index.mjs"),
      pluginEntryModuleMutatesAllowlistForUndeclaredTool(),
      "utf-8",
    );

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

  it("loads plugins from directories whose names start with '..' (non-traversal)", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/..echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const plugins = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });

    expect(plugins.list().map((p) => p.id)).toEqual(["echo"]);
  });

  it("skips plugins whose entry path traverses outside the plugin directory", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.yml"),
      pluginManifestYaml({ entry: "../outside.mjs" }),
      "utf-8",
    );
    await writeFile(join(home, "plugins/outside.mjs"), pluginEntryModule(), "utf-8");

    const { logger, warnings } = createCapturingLogger();
    const plugins = await PluginRegistry.load({
      home,
      logger,
    });

    expect(plugins.list()).toEqual([]);
    expect(warnings.some((entry) => entry.msg.startsWith("plugins."))).toBe(true);
  });

  itPosix("skips plugins whose entry path escapes via symlink", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");

    const outside = join(home, "plugins/outside.mjs");
    await writeFile(outside, pluginEntryModule(), "utf-8");
    await symlink(outside, join(pluginDir, "index.mjs"));

    const { logger } = createCapturingLogger();
    const plugins = await PluginRegistry.load({
      home,
      logger,
    });

    expect(plugins.list()).toEqual([]);
  });

  it("loads plugins when plugin.lock.json matches pinned version and integrity", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });

    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const manifestRaw = await readFile(join(pluginDir, "plugin.yml"), "utf-8");
    const entryRaw = await readFile(join(pluginDir, "index.mjs"), "utf-8");
    const integritySha256 = pluginIntegritySha256Hex(manifestRaw, entryRaw);

    await writeFile(
      join(pluginDir, "plugin.lock.json"),
      pluginLockJson({ pinnedVersion: "0.0.1", integritySha256 }),
      "utf-8",
    );

    const { logger } = createCapturingLogger();
    const plugins = await PluginRegistry.load({
      home,
      logger,
    });

    const listed = plugins.list() as unknown as Array<Record<string, unknown>>;
    expect(listed.map((p) => p["id"])).toEqual(["echo"]);
    expect(
      (listed[0]?.["install"] as Record<string, unknown> | undefined)?.["pinned_version"],
    ).toBe("0.0.1");
    expect(
      (listed[0]?.["install"] as Record<string, unknown> | undefined)?.["integrity_sha256"],
    ).toBe(integritySha256);
  });

  it("loads plugins when plugin.lock.json integrity uses uppercase hex", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });

    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const manifestRaw = await readFile(join(pluginDir, "plugin.yml"), "utf-8");
    const entryRaw = await readFile(join(pluginDir, "index.mjs"), "utf-8");
    const integritySha256 = pluginIntegritySha256Hex(manifestRaw, entryRaw);

    await writeFile(
      join(pluginDir, "plugin.lock.json"),
      pluginLockJson({ pinnedVersion: "0.0.1", integritySha256: integritySha256.toUpperCase() }),
      "utf-8",
    );

    const { logger, warnings } = createCapturingLogger();
    const plugins = await PluginRegistry.load({
      home,
      logger,
    });

    const listed = plugins.list() as unknown as Array<Record<string, unknown>>;
    expect(listed.map((p) => p["id"])).toEqual(["echo"]);
    expect(warnings.some((entry) => entry.msg === "plugins.lock_integrity_mismatch")).toBe(false);
  });

  it("skips plugins when plugin.lock.json pinned_version does not match manifest version", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });

    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const manifestRaw = await readFile(join(pluginDir, "plugin.yml"), "utf-8");
    const entryRaw = await readFile(join(pluginDir, "index.mjs"), "utf-8");
    const integritySha256 = pluginIntegritySha256Hex(manifestRaw, entryRaw);

    await writeFile(
      join(pluginDir, "plugin.lock.json"),
      pluginLockJson({ pinnedVersion: "0.0.2", integritySha256 }),
      "utf-8",
    );

    const { logger, warnings } = createCapturingLogger();
    const plugins = await PluginRegistry.load({
      home,
      logger,
    });

    expect(plugins.list()).toEqual([]);
    expect(warnings.some((entry) => entry.msg === "plugins.lock_version_mismatch")).toBe(true);
  });

  it("skips plugins when plugin.lock.json integrity does not match installed plugin contents", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });

    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    await writeFile(
      join(pluginDir, "plugin.lock.json"),
      pluginLockJson({ pinnedVersion: "0.0.1", integritySha256: "b".repeat(64) }),
      "utf-8",
    );

    const { logger, warnings } = createCapturingLogger();
    const plugins = await PluginRegistry.load({
      home,
      logger,
    });

    expect(plugins.list()).toEqual([]);
    expect(warnings.some((entry) => entry.msg === "plugins.lock_integrity_mismatch")).toBe(true);
  });

  itPosix("skips plugins when plugin.lock.json exists but is unreadable", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });

    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const manifestRaw = await readFile(join(pluginDir, "plugin.yml"), "utf-8");
    const entryRaw = await readFile(join(pluginDir, "index.mjs"), "utf-8");
    const integritySha256 = pluginIntegritySha256Hex(manifestRaw, entryRaw);

    const lockPath = join(pluginDir, "plugin.lock.json");
    await writeFile(lockPath, pluginLockJson({ pinnedVersion: "0.0.1", integritySha256 }), "utf-8");
    await chmod(lockPath, 0o000);

    const { logger, warnings } = createCapturingLogger();
    const plugins = await PluginRegistry.load({
      home,
      logger,
    });

    expect(plugins.list()).toEqual([]);
    expect(warnings.some((entry) => entry.msg === "plugins.lock_unreadable")).toBe(true);
  });

  itPosix("skips plugins when plugin root is world-writable", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    await chmod(pluginDir, 0o777);

    const { logger } = createCapturingLogger();
    const plugins = await PluginRegistry.load({
      home,
      logger,
    });

    expect(plugins.list()).toEqual([]);
  });

  itPosix("skips plugins when plugins root directory is world-writable", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    const pluginsRoot = join(home, "plugins");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    await chmod(pluginsRoot, 0o777);

    const { logger } = createCapturingLogger();
    const plugins = await PluginRegistry.load({
      home,
      logger,
    });

    expect(plugins.list()).toEqual([]);
  });

  itPosix("skips plugins when plugin root ownership does not match current uid", async () => {
    const currentUid = process.getuid();
    vi.spyOn(process, "getuid").mockReturnValue(currentUid + 1);

    home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
    const pluginDir = join(home, "plugins/echo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(pluginDir, "index.mjs"), pluginEntryModule(), "utf-8");

    const { logger } = createCapturingLogger();
    const plugins = await PluginRegistry.load({
      home,
      logger,
    });

    expect(plugins.list()).toEqual([]);
  });
});
