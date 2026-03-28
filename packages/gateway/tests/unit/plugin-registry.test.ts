import { chmod, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { PluginRegistry } from "../../src/modules/plugins/registry.js";
import {
  ALL_OF_OBJECT_SHAPES_CONFIG_SCHEMA,
  ALL_OF_REF_OBJECT_SHAPES_CONFIG_SCHEMA,
  ALLOW_ADDITIONAL_PROPERTIES_SCHEMA,
  NON_OBJECT_ALL_OF_SCHEMA,
  pluginEntryModule,
  pluginEntryModuleMutatesAllowlistForUndeclaredTool,
  pluginEntryModuleMutatesRoutesAndRegistersRouter,
  PROTO_POLLUTION_CONFIG_SCHEMA,
  REF_WITH_INLINE_PROPERTIES_SCHEMA,
  REF_WITH_NESTED_OBJECT_SCHEMA,
  REF_WITH_TYPE_OBJECT_SCHEMA,
  REQUIRED_GREETING_CONFIG_SCHEMA,
  UNKNOWN_KEY_CONFIG_SCHEMA,
} from "./plugin-registry.fixtures.test-support.js";
import {
  createCapturingLogger,
  createEchoPluginHome,
  createSilentLogger,
  countBroadcastEvents,
  countPlannerEventsOfType,
  echoToolCall,
  expectLifecycleAuditLinkage,
  expectToolInvokedAuditLinkage,
  findBroadcastEvent,
  getLastBroadcastEvent,
  withTestContainer,
  type EchoPluginFixtureOptions,
  type PluginTestContainer,
} from "./plugin-registry.test-support.js";

describe("PluginRegistry", () => {
  let home: string | undefined;
  const isPosix = process.platform !== "win32" && typeof process.getuid === "function";
  const itPosix = isPosix ? it : it.skip;

  function requireHome(): string {
    if (!home) {
      throw new Error("plugin home not initialized");
    }

    return home;
  }

  async function setupPlugin(opts: EchoPluginFixtureOptions = {}) {
    const fixture = await createEchoPluginHome(opts);
    home = fixture.home;
    return fixture;
  }

  async function loadPlugins({
    logger = createSilentLogger(),
    container,
  }: {
    logger?: Parameters<typeof PluginRegistry.load>[0]["logger"];
    container?: PluginTestContainer;
  } = {}) {
    return PluginRegistry.load({
      home: requireHome(),
      logger,
      ...(container ? { container } : {}),
    });
  }

  async function executeEchoTool(
    plugins: PluginRegistry,
    overrides: Partial<Parameters<PluginRegistry["executeTool"]>[0]> = {},
  ) {
    return plugins.executeTool(echoToolCall(requireHome(), overrides));
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    if (home) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  it("loads plugins from TYRUM_HOME/plugins and executes declared tools/commands", async () => {
    await setupPlugin();

    const plugins = await loadPlugins();
    expect(plugins.list().map((plugin) => plugin.id)).toEqual(["echo"]);

    const cmd = await plugins.tryExecuteCommand("/echo hello world");
    expect(cmd?.output).toBe("hello world");

    const tool = await executeEchoTool(plugins);
    expect(tool?.output).toBe("hi");
    expect(tool?.error).toBeUndefined();
  });

  it("can skip workspace plugin directories when requested", async () => {
    await setupPlugin();

    const plugins = await PluginRegistry.load({
      home: requireHome(),
      logger: createSilentLogger(),
      includeWorkspacePlugins: false,
      includeUserPlugins: false,
    });

    expect(plugins.list()).toEqual([]);
  });

  it("emits plugin.lifecycle loaded events with durable audit linkage", async () => {
    await setupPlugin();

    await withTestContainer(requireHome(), async (container) => {
      const plugins = await loadPlugins({ container });
      expect(plugins.list().map((plugin) => plugin.id)).toEqual(["echo"]);

      const loaded = await findBroadcastEvent(
        container,
        (row) => row.message.type === "plugin.lifecycle",
      );
      await expectLifecycleAuditLinkage(container, loaded, {
        kind: "loaded",
        pluginId: "echo",
      });
    });
  });

  it("emits plugin.lifecycle failed events with durable audit linkage", async () => {
    await setupPlugin({
      config: {
        fileName: "config.yml",
        raw: "unexpected: true\n",
      },
    });

    await withTestContainer(requireHome(), async (container) => {
      const plugins = await loadPlugins({ container });
      expect(plugins.list()).toHaveLength(0);

      const failed = await findBroadcastEvent(
        container,
        (row) =>
          row.message.type === "plugin.lifecycle" && row.message.payload?.["kind"] === "failed",
      );
      await expectLifecycleAuditLinkage(container, failed, {
        kind: "failed",
        pluginId: "echo",
        reason: "invalid_config",
      });
    });
  });

  it("emits plugin_tool.invoked events with durable audit linkage", async () => {
    await setupPlugin();

    await withTestContainer(requireHome(), async (container) => {
      const plugins = await loadPlugins({ container });
      const outboxBefore = await countBroadcastEvents(container);

      const toolRes = await executeEchoTool(plugins, {
        auditPlanId: "agent-turn-test",
        conversationId: "conversation-1",
        channel: "local",
        threadId: "thread-1",
        policySnapshotId: "550e8400-e29b-41d4-a716-446655440000",
      });

      expect(toolRes?.output).toBe("hi");
      expect(await countBroadcastEvents(container)).toBe(outboxBefore + 1);

      const lastOutbox = await getLastBroadcastEvent(container);
      await expectToolInvokedAuditLinkage(container, lastOutbox, {
        planKey: "gateway.plugins.tool_invoked:agent-turn-test",
        pluginId: "echo",
        toolId: "plugin.echo.echo",
        toolCallId: "call-1",
        policySnapshotId: "550e8400-e29b-41d4-a716-446655440000",
      });
    });
  });

  it("does not steal step indices from planner append on shared plans", async () => {
    await setupPlugin();

    await withTestContainer(requireHome(), async (container) => {
      const plugins = await loadPlugins({ container });
      await executeEchoTool(plugins, { auditPlanId: "agent-turn-test" });

      const plannerAppend = await container.eventLog.append({
        tenantId: DEFAULT_TENANT_ID,
        replayId: "planner-replay-1",
        planKey: "agent-turn-test",
        stepIndex: 0,
        occurredAt: new Date().toISOString(),
        action: { type: "planner.step" },
      });
      expect(plannerAppend.kind).toBe("inserted");
    });
  });

  it("does not persist tool audit records when outbox insert fails", async () => {
    await setupPlugin();

    await withTestContainer(requireHome(), async (container) => {
      const plugins = await loadPlugins({ container });
      await container.db.exec("DROP TABLE outbox");

      expect(await countPlannerEventsOfType(container, "plugin_tool.invoked")).toBe(0);

      const toolRes = await executeEchoTool(plugins, { auditPlanId: "agent-turn-test" });
      expect(toolRes?.output).toBe("hi");
      expect(await countPlannerEventsOfType(container, "plugin_tool.invoked")).toBe(0);
    });
  });

  it("logs a warning when plugin tool audit emission fails", async () => {
    await setupPlugin();

    await withTestContainer(requireHome(), async (container) => {
      const { logger, warnings } = createCapturingLogger();
      const plugins = await loadPlugins({ logger, container });
      const originalAppendNext = container.eventLog.appendNext.bind(container.eventLog);
      container.eventLog.appendNext = async () => {
        throw new Error("simulated audit failure");
      };

      try {
        const toolRes = await executeEchoTool(plugins, { auditPlanId: "agent-turn-test" });
        expect(toolRes?.output).toBe("hi");
      } finally {
        container.eventLog.appendNext = originalAppendNext;
      }

      expect(warnings.some((entry) => entry.msg === "plugins.tool_invoked_emit_failed")).toBe(true);
    });
  });

  it("rejects plugins whose manifest omits required 'contributes' field", async () => {
    await setupPlugin({ manifestOpts: { includeContributes: false } });

    const plugins = await loadPlugins();
    expect(plugins.list()).toEqual([]);
    expect(await plugins.tryExecuteCommand("/echo hello")).toBeUndefined();
    expect(await executeEchoTool(plugins)).toBeUndefined();
  });

  it("rejects plugins whose manifest omits required 'permissions' field", async () => {
    await setupPlugin({ manifestOpts: { includePermissions: false } });

    const plugins = await loadPlugins();
    expect(plugins.list()).toEqual([]);
    expect(await plugins.tryExecuteCommand("/echo hello")).toBeUndefined();
  });

  it("rejects plugins whose manifest omits required 'config_schema' field", async () => {
    await setupPlugin({ manifestOpts: { includeConfigSchema: false } });

    const plugins = await loadPlugins();
    expect(plugins.list()).toEqual([]);
    expect(await plugins.tryExecuteCommand("/echo hello")).toBeUndefined();
  });

  it("rejects plugins when config contains unknown keys (additionalProperties defaults to false)", async () => {
    await setupPlugin({
      manifestOpts: { configSchema: UNKNOWN_KEY_CONFIG_SCHEMA },
      config: {
        fileName: "config.json",
        raw: JSON.stringify({ greeting: "hi", extra: "nope" }),
      },
    });

    const plugins = await loadPlugins();
    expect(plugins.list()).toEqual([]);
  });

  it("loads plugins when config schema composes object shapes via allOf", async () => {
    await setupPlugin({
      manifestOpts: { configSchema: ALL_OF_OBJECT_SHAPES_CONFIG_SCHEMA },
      config: {
        fileName: "config.json",
        raw: JSON.stringify({ greeting: "hi", target: "world" }),
      },
    });

    const plugins = await loadPlugins();
    expect(plugins.list().map((plugin) => plugin.id)).toEqual(["echo"]);
  });

  it("rejects unknown keys when config schema composes object shapes via allOf", async () => {
    await setupPlugin({
      manifestOpts: { configSchema: ALL_OF_OBJECT_SHAPES_CONFIG_SCHEMA },
      config: {
        fileName: "config.json",
        raw: JSON.stringify({ greeting: "hi", target: "world", extra: "nope" }),
      },
    });

    const plugins = await loadPlugins();
    expect(plugins.list()).toEqual([]);
  });

  it("loads plugins when config schema composes $ref object shapes via allOf", async () => {
    await setupPlugin({
      manifestOpts: { configSchema: ALL_OF_REF_OBJECT_SHAPES_CONFIG_SCHEMA },
      config: {
        fileName: "config.json",
        raw: JSON.stringify({ greeting: "hi", target: "world" }),
      },
    });

    const plugins = await loadPlugins();
    expect(plugins.list().map((plugin) => plugin.id)).toEqual(["echo"]);
  });

  it("rejects unknown keys when config schema composes $ref object shapes via allOf", async () => {
    await setupPlugin({
      manifestOpts: { configSchema: ALL_OF_REF_OBJECT_SHAPES_CONFIG_SCHEMA },
      config: {
        fileName: "config.json",
        raw: JSON.stringify({ greeting: "hi", target: "world", extra: "nope" }),
      },
    });

    const plugins = await loadPlugins();
    expect(plugins.list()).toEqual([]);
  });

  it("rejects unknown keys for $ref object schemas even when referenced in allOf elsewhere", async () => {
    await setupPlugin({
      manifestOpts: { configSchema: REF_WITH_NESTED_OBJECT_SCHEMA },
      config: {
        fileName: "config.json",
        raw: JSON.stringify({
          greeting: "hi",
          target: "world",
          nested: { greeting: "hi", extra: "nope" },
        }),
      },
    });

    const plugins = await loadPlugins();
    expect(plugins.list()).toEqual([]);
  });

  it("loads plugins when config schema uses $ref alongside type: object", async () => {
    await setupPlugin({
      manifestOpts: { configSchema: REF_WITH_TYPE_OBJECT_SCHEMA },
      config: {
        fileName: "config.json",
        raw: JSON.stringify({ greeting: "hi" }),
      },
    });

    const plugins = await loadPlugins();
    expect(plugins.list().map((plugin) => plugin.id)).toEqual(["echo"]);
  });

  it("loads plugins when config schema uses $ref alongside inline properties", async () => {
    await setupPlugin({
      manifestOpts: { configSchema: REF_WITH_INLINE_PROPERTIES_SCHEMA },
      config: {
        fileName: "config.json",
        raw: JSON.stringify({ greeting: "hi", target: "world" }),
      },
    });

    const plugins = await loadPlugins();
    expect(plugins.list().map((plugin) => plugin.id)).toEqual(["echo"]);
  });

  it("does not allow __proto__ keys to pollute normalized config_schema", async () => {
    await setupPlugin({
      manifestOpts: { configSchema: PROTO_POLLUTION_CONFIG_SCHEMA },
      config: {
        fileName: "config.json",
        raw: JSON.stringify({ greeting: "hi" }),
      },
    });

    const plugins = await loadPlugins();
    expect(plugins.list().map((plugin) => plugin.id)).toEqual(["echo"]);

    const manifest = plugins.getManifest("echo");
    expect(manifest).toBeDefined();
    const schema = (manifest as { config_schema: Record<string, unknown> }).config_schema;
    const props = schema["properties"] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(props, "__proto__")).toBe(true);
    expect(props["polluted"]).toBeUndefined();
  });

  it("does not force unevaluatedProperties defaults when allOf does not describe an object shape", async () => {
    await setupPlugin({
      manifestOpts: { configSchema: NON_OBJECT_ALL_OF_SCHEMA },
      config: {
        fileName: "config.json",
        raw: JSON.stringify({ greeting: "hi" }),
      },
    });

    const plugins = await loadPlugins();
    expect(plugins.list().map((plugin) => plugin.id)).toEqual(["echo"]);
  });

  it("records config_path when config file is present but empty", async () => {
    const { pluginDir } = await setupPlugin({
      manifestOpts: { configSchema: REQUIRED_GREETING_CONFIG_SCHEMA },
      config: { fileName: "config.yml", raw: "" },
    });

    const { logger, warnings } = createCapturingLogger();
    const plugins = await loadPlugins({ logger });
    expect(plugins.list()).toEqual([]);

    const invalidConfig = warnings.find((entry) => entry.msg === "plugins.invalid_config");
    expect(invalidConfig?.fields["config_path"]).toBe(join(pluginDir, "config.yml"));
  });

  it("loads plugins when config schema explicitly allows additionalProperties", async () => {
    await setupPlugin({
      manifestOpts: { configSchema: ALLOW_ADDITIONAL_PROPERTIES_SCHEMA },
      config: {
        fileName: "config.json",
        raw: JSON.stringify({ greeting: "hi", extra: "ok" }),
      },
    });

    const plugins = await loadPlugins();
    expect(plugins.list().map((plugin) => plugin.id)).toEqual(["echo"]);
  });

  it("rejects plugins when runtime registration includes undeclared contributions", async () => {
    await setupPlugin({ manifestOpts: { tools: [], commands: [] } });

    const plugins = await loadPlugins();
    expect(plugins.list()).toEqual([]);
    expect(await plugins.tryExecuteCommand("/echo hello")).toBeUndefined();
    expect(await executeEchoTool(plugins)).toBeUndefined();
  });

  it("does not crash when plugin mutates manifest routes before returning a router contribution", async () => {
    await setupPlugin({ entry: pluginEntryModuleMutatesRoutesAndRegistersRouter() });

    const plugins = await loadPlugins();
    expect(plugins.list()).toEqual([]);
  });

  it("rejects undeclared tools even when registerPlugin mutates manifest allowlists", async () => {
    await setupPlugin({
      manifestOpts: { tools: [], commands: [] },
      entry: pluginEntryModuleMutatesAllowlistForUndeclaredTool(),
    });

    const plugins = await loadPlugins();
    expect(plugins.list()).toEqual([]);
    expect(await executeEchoTool(plugins, { toolId: "plugin.echo.undeclared" })).toBeUndefined();
  });

  it("loads plugins from directories whose names start with '..' (non-traversal)", async () => {
    await setupPlugin({ pluginDirName: "..echo" });

    const plugins = await loadPlugins();
    expect(plugins.list().map((plugin) => plugin.id)).toEqual(["echo"]);
  });

  it("skips plugins whose entry path traverses outside the plugin directory", async () => {
    await setupPlugin({
      manifestOpts: { entry: "../outside.mjs" },
      files: [
        {
          base: "pluginsRoot",
          relativePath: "outside.mjs",
          raw: pluginEntryModule(),
        },
      ],
    });

    const { logger, warnings } = createCapturingLogger();
    const plugins = await loadPlugins({ logger });
    expect(plugins.list()).toEqual([]);
    expect(warnings.some((entry) => entry.msg.startsWith("plugins."))).toBe(true);
  });

  itPosix("skips plugins whose entry path escapes via symlink", async () => {
    const { pluginDir, pluginsRoot } = await setupPlugin({
      entry: null,
      files: [
        {
          base: "pluginsRoot",
          relativePath: "outside.mjs",
          raw: pluginEntryModule(),
        },
      ],
    });

    await symlink(join(pluginsRoot, "outside.mjs"), join(pluginDir, "index.mjs"));

    const { logger } = createCapturingLogger();
    const plugins = await loadPlugins({ logger });
    expect(plugins.list()).toEqual([]);
  });

  it("loads plugins when plugin.lock.json matches pinned version and integrity", async () => {
    const { integritySha256 } = await setupPlugin({ lock: { pinnedVersion: "0.0.1" } });

    const { logger } = createCapturingLogger();
    const plugins = await loadPlugins({ logger });
    const listed = plugins.list() as Array<Record<string, unknown>>;
    const install = listed[0]?.["install"] as Record<string, unknown> | undefined;

    expect(listed.map((plugin) => plugin["id"])).toEqual(["echo"]);
    expect(install?.["pinned_version"]).toBe("0.0.1");
    expect(install?.["integrity_sha256"]).toBe(integritySha256);
  });

  it("loads plugins when plugin.lock.json integrity uses uppercase hex", async () => {
    await setupPlugin({
      lock: {
        pinnedVersion: "0.0.1",
        uppercaseIntegrity: true,
      },
    });

    const { logger, warnings } = createCapturingLogger();
    const plugins = await loadPlugins({ logger });

    expect(plugins.list().map((plugin) => plugin.id)).toEqual(["echo"]);
    expect(warnings.some((entry) => entry.msg === "plugins.lock_integrity_mismatch")).toBe(false);
  });

  it("skips plugins when plugin.lock.json pinned_version does not match manifest version", async () => {
    await setupPlugin({ lock: { pinnedVersion: "0.0.2" } });

    const { logger, warnings } = createCapturingLogger();
    const plugins = await loadPlugins({ logger });

    expect(plugins.list()).toEqual([]);
    expect(warnings.some((entry) => entry.msg === "plugins.lock_version_mismatch")).toBe(true);
  });

  it("skips plugins when plugin.lock.json integrity does not match installed plugin contents", async () => {
    await setupPlugin({
      lock: {
        pinnedVersion: "0.0.1",
        integritySha256: "b".repeat(64),
      },
    });

    const { logger, warnings } = createCapturingLogger();
    const plugins = await loadPlugins({ logger });

    expect(plugins.list()).toEqual([]);
    expect(warnings.some((entry) => entry.msg === "plugins.lock_integrity_mismatch")).toBe(true);
  });

  itPosix("skips plugins when plugin.lock.json exists but is unreadable", async () => {
    await setupPlugin({
      lock: {
        pinnedVersion: "0.0.1",
        mode: 0o000,
      },
    });

    const { logger, warnings } = createCapturingLogger();
    const plugins = await loadPlugins({ logger });

    expect(plugins.list()).toEqual([]);
    expect(warnings.some((entry) => entry.msg === "plugins.lock_unreadable")).toBe(true);
  });

  itPosix("skips plugins when plugin root is world-writable", async () => {
    const { pluginDir } = await setupPlugin();
    await chmod(pluginDir, 0o777);

    const { logger } = createCapturingLogger();
    const plugins = await loadPlugins({ logger });
    expect(plugins.list()).toEqual([]);
  });

  itPosix("skips plugins when plugins root directory is world-writable", async () => {
    const { pluginsRoot } = await setupPlugin();
    await chmod(pluginsRoot, 0o777);

    const { logger } = createCapturingLogger();
    const plugins = await loadPlugins({ logger });
    expect(plugins.list()).toEqual([]);
  });

  itPosix("skips plugins when plugin root ownership does not match current uid", async () => {
    const currentUid = process.getuid();
    vi.spyOn(process, "getuid").mockReturnValue(currentUid + 1);

    await setupPlugin();

    const { logger } = createCapturingLogger();
    const plugins = await loadPlugins({ logger });
    expect(plugins.list()).toEqual([]);
  });
});
