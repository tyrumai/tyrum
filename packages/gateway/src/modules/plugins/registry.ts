import type { PluginManifest as PluginManifestT } from "@tyrum/contracts";
import type { Hono } from "hono";
import { type Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { GatewayContainer } from "../../container.js";
import type { ToolDescriptor } from "../agent/tools.js";
import type { Logger } from "../observability/logger.js";
import type { PluginInstallInfo } from "./lockfile.js";
import { type PluginDir, resolvePluginSearchDirs } from "./directories.js";
import { emitPluginLifecycleEvent, emitPluginToolInvokedEvent } from "./registry-events.js";
import {
  cloneManifest,
  collectPluginRegistration,
  getCurrentUid,
  loadConfigFromDir,
  loadManifestFromDir,
  loadPluginLock,
  loadRegisterFn,
  normalizePluginId,
  parsePluginCommand,
  resolvePluginEntryPath,
  resolveSecureDir,
  selectContainerForPlugin,
  verifyPluginIntegrity,
} from "./registry-manifest-helpers.js";
import { validatePluginConfig } from "./registry-schema-helpers.js";
import type { LoadedPlugin, PluginToolRegistration } from "./registry-types.js";

export type {
  PluginCommandContext,
  PluginCommandExecuteResult,
  PluginCommandRegistration,
  PluginRegisterFn,
  PluginRegistration,
  PluginToolContext,
  PluginToolExecuteResult,
  PluginToolRegistration,
} from "./registry-types.js";

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class PluginRegistry {
  private readonly plugins = new Map<string, LoadedPlugin>();

  constructor(
    private readonly opts: {
      logger: Logger;
      container?: GatewayContainer;
      fetchImpl?: typeof fetch;
    },
  ) {}

  static async load(opts: {
    home: string;
    userHome?: string;
    logger: Logger;
    container?: GatewayContainer;
    fetchImpl?: typeof fetch;
    includeWorkspacePlugins?: boolean;
    includeUserPlugins?: boolean;
    includeBundledPlugins?: boolean;
  }): Promise<PluginRegistry> {
    const dirs = resolvePluginSearchDirs(opts);
    return await PluginRegistry.loadFromSearchDirs({
      dirs,
      logger: opts.logger,
      container: opts.container,
      fetchImpl: opts.fetchImpl,
    });
  }

  static async loadFromSearchDirs(opts: {
    dirs: PluginDir[];
    logger: Logger;
    container?: GatewayContainer;
    fetchImpl?: typeof fetch;
  }): Promise<PluginRegistry> {
    const registry = new PluginRegistry({
      logger: opts.logger,
      container: opts.container,
      fetchImpl: opts.fetchImpl,
    });
    await registry.loadFromDirectories(opts.dirs);
    return registry;
  }

  list(): Array<{
    id: string;
    name: string;
    version: string;
    contributions: PluginManifestT["contributes"] | undefined;
    permissions: PluginManifestT["permissions"] | undefined;
    install?: PluginInstallInfo;
    loaded_at: string;
    source_dir: string;
  }> {
    return [...this.plugins.values()]
      .map((plugin) => ({
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        contributions: plugin.manifest.contributes,
        permissions: plugin.manifest.permissions,
        install: plugin.install ? structuredClone(plugin.install) : undefined,
        loaded_at: plugin.loaded_at,
        source_dir: plugin.source_dir,
      }))
      .toSorted((a, b) => a.id.localeCompare(b.id));
  }

  getManifest(pluginId: string): PluginManifestT | undefined {
    return this.plugins.get(normalizePluginId(pluginId))?.manifest;
  }
  getToolDescriptors(): ToolDescriptor[] {
    return [...this.plugins.values()].flatMap((plugin) =>
      [...plugin.tools.values()].map((tool) => {
        const effect =
          tool.descriptor.effect === "read_only" || tool.descriptor.effect === "state_changing"
            ? tool.descriptor.effect
            : undefined;
        if (!effect) {
          this.opts.logger.warn("plugins.tool_effect_missing", {
            plugin_id: plugin.manifest.id,
            tool_id: tool.descriptor.id,
            default_effect: "state_changing",
          });
        }
        return {
          id: tool.descriptor.id,
          description: tool.descriptor.description,
          effect: effect ?? "state_changing",
          keywords: tool.descriptor.keywords,
          inputSchema: tool.descriptor.inputSchema,
          source: "plugin" as const,
          family: tool.descriptor.family ?? "plugin",
          backingServerId: tool.descriptor.backingServerId,
        };
      }),
    );
  }

  getTool(toolId: string): { plugin: PluginManifestT; tool: PluginToolRegistration } | undefined {
    for (const plugin of this.plugins.values()) {
      const tool = plugin.tools.get(toolId);
      if (tool) return { plugin: plugin.manifest, tool };
    }
    return undefined;
  }

  async executeTool(params: {
    toolId: string;
    toolCallId: string;
    args: unknown;
    home: string;
    agentId: string;
    workspaceId: string;
    auditPlanId?: string;
    conversationId?: string;
    channel?: string;
    threadId?: string;
    policySnapshotId?: string;
  }): Promise<import("./registry-types.js").PluginToolExecuteResult | undefined> {
    const found = this.getTool(params.toolId);
    if (!found) return undefined;
    const startMs = Date.now();
    let result: import("./registry-types.js").PluginToolExecuteResult;
    try {
      result = await found.tool.execute(params.args, {
        home: params.home,
        agent_id: params.agentId,
        workspace_id: params.workspaceId,
        logger: this.opts.logger,
        fetch: this.opts.fetchImpl ?? fetch,
        container: selectContainerForPlugin(found.plugin, this.opts.container),
      });
    } catch (err) {
      result = { output: "", error: errorMessage(err) };
    }
    await emitPluginToolInvokedEvent(this.opts, {
      pluginId: found.plugin.id,
      pluginVersion: found.plugin.version,
      toolId: params.toolId,
      toolCallId: params.toolCallId,
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      conversationId: params.conversationId,
      channel: params.channel,
      threadId: params.threadId,
      policySnapshotId: params.policySnapshotId,
      auditPlanId: params.auditPlanId,
      outcome: result.error ? "failed" : "succeeded",
      error: result.error,
      durationMs: Math.max(0, Date.now() - startMs),
    });
    return result;
  }

  async tryExecuteCommand(
    raw: string,
  ): Promise<import("./registry-types.js").PluginCommandExecuteResult | undefined> {
    const command = parsePluginCommand(raw);
    if (!command) return undefined;
    for (const plugin of this.plugins.values()) {
      const cmd = plugin.commands.get(command.name);
      if (!cmd) continue;
      try {
        return await cmd.execute(command.args, {
          logger: this.opts.logger,
          container: selectContainerForPlugin(plugin.manifest, this.opts.container),
        });
      } catch (err) {
        return { output: `Plugin command '${command.name}' failed: ${errorMessage(err)}` };
      }
    }
    return undefined;
  }

  routers(): Array<{ pluginId: string; router: Hono }> {
    return [...this.plugins.values()].flatMap((plugin) =>
      plugin.router ? [{ pluginId: plugin.manifest.id, router: plugin.router }] : [],
    );
  }

  getRouter(pluginId: string): Hono | undefined {
    return this.plugins.get(normalizePluginId(pluginId))?.router;
  }

  private async loadFromDirectories(dirs: PluginDir[]): Promise<void> {
    for (const dir of dirs) await this.loadFromDirectory(dir);
  }

  private async loadFromDirectory(dir: PluginDir): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir.path, { withFileTypes: true });
    } catch {
      // Intentional: absent plugin directories are ignored during discovery.
      return;
    }
    const currentUid = getCurrentUid();
    const rootRealDir = await resolveSecureDir({
      logger: this.opts.logger,
      event: "plugins.insecure_root_dir",
      kind: dir.kind,
      path: dir.path,
      currentUid,
    });
    if (!rootRealDir) return;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginDir = join(dir.path, entry.name);
      const pluginRealDir = await resolveSecureDir({
        logger: this.opts.logger,
        event: "plugins.insecure_plugin_dir",
        kind: dir.kind,
        path: pluginDir,
        currentUid,
        rootDir: dir.path,
        rootRealDir,
      });
      if (pluginRealDir) await this.loadPluginFromDirectory(dir, pluginDir, pluginRealDir);
    }
  }

  private async loadPluginFromDirectory(
    dir: PluginDir,
    pluginDir: string,
    pluginRealDir: string,
  ): Promise<void> {
    let manifestFile: Awaited<ReturnType<typeof loadManifestFromDir>>;
    try {
      manifestFile = await loadManifestFromDir(pluginDir);
    } catch (err) {
      const error = errorMessage(err);
      this.opts.logger.warn("plugins.invalid_manifest", { source_dir: pluginDir, error });
      await emitPluginLifecycleEvent(this.opts, {
        kind: "failed",
        sourceKind: dir.kind,
        sourceDir: pluginDir,
        reason: "invalid_manifest",
        error,
      });
      return;
    }
    if (!manifestFile) return;
    const id = normalizePluginId(manifestFile.manifest.id);
    if (this.plugins.has(id)) return;
    const manifest = cloneManifest({ ...manifestFile.manifest, id });
    const failLifecycle = async (
      event: string,
      reason: string,
      extra: Record<string, unknown> = {},
      error?: string,
    ) => {
      this.opts.logger.warn(event, {
        plugin_id: id,
        source_dir: pluginDir,
        ...extra,
        ...(error ? { error } : {}),
      });
      await emitPluginLifecycleEvent(this.opts, {
        kind: "failed",
        plugin: manifest,
        sourceKind: dir.kind,
        sourceDir: pluginDir,
        reason,
        error,
      });
    };
    if (!manifest.entry)
      return void (await failLifecycle("plugins.missing_entry", "missing_entry"));
    const pluginInstall = await loadPluginLock({
      logger: this.opts.logger,
      pluginId: id,
      pluginDir,
      manifestVersion: manifest.version,
    });
    if (pluginInstall === null) return;
    let configPath: string | undefined, config: unknown;
    try {
      const loadedConfig = await loadConfigFromDir(pluginDir);
      configPath = loadedConfig.path;
      config = loadedConfig.config;
    } catch (err) {
      this.opts.logger.warn("plugins.invalid_config", {
        plugin_id: id,
        source_dir: pluginDir,
        error: errorMessage(err),
      });
      return;
    }
    const configValidation = validatePluginConfig({ schema: manifest.config_schema, config });
    if (!configValidation.ok)
      return void (await failLifecycle(
        "plugins.invalid_config",
        "invalid_config",
        { config_path: configPath },
        configValidation.error,
      ));
    manifest.config_schema = configValidation.normalizedSchema;
    const entryPath = await resolvePluginEntryPath({
      logger: this.opts.logger,
      pluginId: id,
      pluginDir,
      pluginRealDir,
      entry: manifest.entry,
    });
    if (
      !entryPath ||
      !(await verifyPluginIntegrity({
        logger: this.opts.logger,
        pluginId: id,
        pluginDir,
        manifestRaw: manifestFile.raw,
        entryPath,
        install: pluginInstall ?? undefined,
      }))
    )
      return;
    const registerFn = await loadRegisterFn({
      logger: this.opts.logger,
      pluginId: id,
      pluginDir,
      entryPath,
    });
    if (!registerFn) {
      this.opts.logger.warn("plugins.missing_register", {
        plugin_id: id,
        source_dir: pluginDir,
        entry_path: entryPath,
      });
      return;
    }
    let registration: import("./registry-types.js").PluginRegistration;
    try {
      registration = await Promise.resolve(
        registerFn({
          manifest: cloneManifest(manifest),
          config: configValidation.config,
          logger: this.opts.logger.child({ plugin_id: id }),
        }),
      );
    } catch (err) {
      this.opts.logger.warn("plugins.register_failed", {
        plugin_id: id,
        source_dir: pluginDir,
        error: errorMessage(err),
      });
      return;
    }
    const { tools, commands, undeclaredTools, undeclaredCommands, undeclaredRouter } =
      collectPluginRegistration(manifest, registration);
    if (undeclaredTools.length > 0 || undeclaredCommands.length > 0 || undeclaredRouter) {
      this.opts.logger.warn("plugins.undeclared_contributions", {
        plugin_id: id,
        source_dir: pluginDir,
        tools: undeclaredTools,
        commands: undeclaredCommands,
        router: undeclaredRouter,
      });
      return;
    }
    this.plugins.set(id, {
      manifest,
      source_dir: pluginDir,
      install: pluginInstall ? structuredClone(pluginInstall) : undefined,
      entry_path: entryPath,
      tools,
      commands,
      router: registration.router,
      loaded_at: new Date().toISOString(),
    });
    this.opts.logger.info("plugins.loaded", {
      plugin_id: id,
      source_dir: pluginDir,
      tools: tools.size,
      commands: commands.size,
      router: Boolean(registration.router),
      kind: dir.kind,
    });
    await emitPluginLifecycleEvent(this.opts, {
      kind: "loaded",
      plugin: manifest,
      sourceKind: dir.kind,
      sourceDir: pluginDir,
      toolsCount: tools.size,
      commandsCount: commands.size,
      router: Boolean(registration.router),
    });
  }
}
