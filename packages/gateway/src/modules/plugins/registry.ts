import { PluginManifest } from "@tyrum/schemas";
import type { PluginManifest as PluginManifestT } from "@tyrum/schemas";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import type { Hono } from "hono";
import type { GatewayContainer } from "../../container.js";
import type { Logger } from "../observability/logger.js";
import type { ToolDescriptor } from "../agent/tools.js";

export type PluginCommandExecuteResult = {
  output: string;
  data?: unknown;
};

export type PluginToolExecuteResult = {
  output: string;
  error?: string;
};

export interface PluginToolContext {
  home: string;
  agent_id: string;
  workspace_id: string;
  logger: Logger;
  fetch: typeof fetch;
  container?: GatewayContainer;
}

export interface PluginCommandContext {
  logger: Logger;
  container?: GatewayContainer;
}

export type PluginToolRegistration = {
  descriptor: ToolDescriptor;
  execute: (args: unknown, ctx: PluginToolContext) => Promise<PluginToolExecuteResult>;
};

export type PluginCommandRegistration = {
  name: string;
  execute: (args: string[], ctx: PluginCommandContext) => Promise<PluginCommandExecuteResult>;
};

export type PluginRegistration = {
  tools?: PluginToolRegistration[];
  commands?: PluginCommandRegistration[];
  router?: Hono;
};

export type PluginRegisterFn = (ctx: {
  manifest: PluginManifestT;
  logger: Logger;
}) => PluginRegistration | Promise<PluginRegistration>;

type LoadedPlugin = {
  manifest: PluginManifestT;
  source_dir: string;
  entry_path: string;
  tools: Map<string, PluginToolRegistration>;
  commands: Map<string, PluginCommandRegistration>;
  router?: Hono;
  loaded_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonOrYaml(contents: string, hintPath?: string): unknown {
  const trimmed = contents.trim();
  if (trimmed.length === 0) return {};
  const isJson = hintPath?.toLowerCase().endsWith(".json") ?? trimmed.startsWith("{");
  if (isJson) {
    return JSON.parse(trimmed) as unknown;
  }
  return parseYaml(trimmed) as unknown;
}

async function tryReadFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return undefined;
  }
}

async function loadManifestFromDir(dir: string): Promise<{ path: string; manifest: PluginManifestT } | undefined> {
  const candidates = ["plugin.yml", "plugin.yaml", "plugin.json"];
  for (const filename of candidates) {
    const path = join(dir, filename);
    const raw = await tryReadFile(path);
    if (!raw) continue;
    const parsed = parseJsonOrYaml(raw, path);
    if (!isRecord(parsed)) {
      return { path, manifest: PluginManifest.parse({ id: basenameSafe(dir), name: basenameSafe(dir), version: "0.0.0" }) };
    }
    return { path, manifest: PluginManifest.parse(parsed) };
  }
  return undefined;
}

function basenameSafe(dir: string): string {
  const normalized = dir.replace(/\\/g, "/");
  const parts = normalized.split("/").filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? "plugin";
}

function resolveBundledPluginsDir(): string {
  // packages/gateway/src/modules/plugins/registry.ts -> packages/gateway/plugins
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../../../plugins");
}

function resolvePluginsDir(home: string): string {
  return join(home, "plugins");
}

function resolveSafeChildPath(parent: string, child: string): string {
  const absParent = resolve(parent);
  const absChild = resolve(absParent, child);
  const rel = relative(absParent, absChild);
  if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("../") && !rel.includes(".."))) {
    return absChild;
  }
  throw new Error(`path escapes plugin directory: ${child}`);
}

function normalizePluginId(id: string): string {
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : "plugin";
}

function toolIdAllowed(manifest: PluginManifestT, toolId: string): boolean {
  return Boolean(manifest.contributes?.tools?.includes(toolId));
}

function commandAllowed(manifest: PluginManifestT, name: string): boolean {
  return Boolean(manifest.contributes?.commands?.includes(name));
}

function selectContainerForPlugin(manifest: PluginManifestT, container?: GatewayContainer): GatewayContainer | undefined {
  if (!container) return undefined;
  if (manifest.permissions?.db) return container;
  return undefined;
}

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
  }): Promise<PluginRegistry> {
    const registry = new PluginRegistry({
      logger: opts.logger,
      container: opts.container,
      fetchImpl: opts.fetchImpl,
    });

    const dirs: Array<{ kind: "workspace" | "user" | "bundled"; path: string }> = [];
    dirs.push({ kind: "workspace", path: resolvePluginsDir(opts.home) });
    if (opts.userHome) {
      dirs.push({ kind: "user", path: resolvePluginsDir(opts.userHome) });
    }
    dirs.push({ kind: "bundled", path: resolveBundledPluginsDir() });

    await registry.loadFromDirectories(dirs);
    return registry;
  }

  list(): Array<{
    id: string;
    name: string;
    version: string;
    contributions: PluginManifestT["contributes"] | undefined;
    permissions: PluginManifestT["permissions"] | undefined;
    loaded_at: string;
    source_dir: string;
  }> {
    return [...this.plugins.values()]
      .map((p) => ({
        id: p.manifest.id,
        name: p.manifest.name,
        version: p.manifest.version,
        contributions: p.manifest.contributes,
        permissions: p.manifest.permissions,
        loaded_at: p.loaded_at,
        source_dir: p.source_dir,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  getManifest(pluginId: string): PluginManifestT | undefined {
    const id = normalizePluginId(pluginId);
    return this.plugins.get(id)?.manifest;
  }

  getToolDescriptors(): ToolDescriptor[] {
    const out: ToolDescriptor[] = [];
    for (const plugin of this.plugins.values()) {
      for (const tool of plugin.tools.values()) {
        out.push(tool.descriptor);
      }
    }
    return out;
  }

  getTool(toolId: string): { plugin: PluginManifestT; tool: PluginToolRegistration } | undefined {
    for (const plugin of this.plugins.values()) {
      const tool = plugin.tools.get(toolId);
      if (tool) {
        return { plugin: plugin.manifest, tool };
      }
    }
    return undefined;
  }

  async executeTool(params: {
    toolId: string;
    args: unknown;
    home: string;
    agentId: string;
    workspaceId: string;
  }): Promise<PluginToolExecuteResult | undefined> {
    const found = this.getTool(params.toolId);
    if (!found) return undefined;

    try {
      return await found.tool.execute(params.args, {
        home: params.home,
        agent_id: params.agentId,
        workspace_id: params.workspaceId,
        logger: this.opts.logger,
        fetch: this.opts.fetchImpl ?? fetch,
        container: selectContainerForPlugin(found.plugin, this.opts.container),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: "", error: message };
    }
  }

  async tryExecuteCommand(
    raw: string,
  ): Promise<PluginCommandExecuteResult | undefined> {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return undefined;
    const normalized = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
    const parts = normalized.trim().split(/\s+/g).filter((p) => p.length > 0);
    if (parts.length === 0) return undefined;

    const name = parts[0]!;
    const args = parts.slice(1);

    for (const plugin of this.plugins.values()) {
      const cmd = plugin.commands.get(name);
      if (!cmd) continue;
      try {
        return await cmd.execute(args, {
          logger: this.opts.logger,
          container: selectContainerForPlugin(plugin.manifest, this.opts.container),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { output: `Plugin command '${name}' failed: ${message}` };
      }
    }

    return undefined;
  }

  routers(): Array<{ pluginId: string; router: Hono }> {
    const out: Array<{ pluginId: string; router: Hono }> = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.router) {
        out.push({ pluginId: plugin.manifest.id, router: plugin.router });
      }
    }
    return out;
  }

  private async loadFromDirectories(
    dirs: Array<{ kind: "workspace" | "user" | "bundled"; path: string }>,
  ): Promise<void> {
    for (const dir of dirs) {
      let entries;
      try {
        entries = await readdir(dir.path, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pluginDir = join(dir.path, entry.name);
        const manifestFile = await loadManifestFromDir(pluginDir);
        if (!manifestFile) continue;

        const id = normalizePluginId(manifestFile.manifest.id);
        if (this.plugins.has(id)) {
          // Higher-precedence directory already registered this plugin id.
          continue;
        }

        const manifest = { ...manifestFile.manifest, id };
        if (!manifest.entry) {
          this.opts.logger.warn("plugins.missing_entry", {
            plugin_id: id,
            source_dir: pluginDir,
          });
          continue;
        }

        const entryPath = resolveSafeChildPath(pluginDir, manifest.entry);

        let registerFn: PluginRegisterFn | undefined;
        try {
          const mod = (await import(pathToFileURL(entryPath).href)) as Record<string, unknown>;
          const candidate = mod["registerPlugin"];
          if (typeof candidate === "function") {
            registerFn = candidate as PluginRegisterFn;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.opts.logger.warn("plugins.import_failed", {
            plugin_id: id,
            source_dir: pluginDir,
            entry_path: entryPath,
            error: message,
          });
          continue;
        }

        if (!registerFn) {
          this.opts.logger.warn("plugins.missing_register", {
            plugin_id: id,
            source_dir: pluginDir,
            entry_path: entryPath,
          });
          continue;
        }

        let registration: PluginRegistration;
        try {
          registration = await Promise.resolve(
            registerFn({ manifest, logger: this.opts.logger.child({ plugin_id: id }) }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.opts.logger.warn("plugins.register_failed", {
            plugin_id: id,
            source_dir: pluginDir,
            error: message,
          });
          continue;
        }

        const tools = new Map<string, PluginToolRegistration>();
        for (const tool of registration.tools ?? []) {
          if (!tool?.descriptor || typeof tool.execute !== "function") continue;
          const toolId = tool.descriptor.id?.trim?.() ?? "";
          if (!toolId) continue;
          if (!toolIdAllowed(manifest, toolId)) {
            this.opts.logger.warn("plugins.tool_not_declared", {
              plugin_id: id,
              tool_id: toolId,
            });
            continue;
          }
          tools.set(toolId, tool);
        }

        const commands = new Map<string, PluginCommandRegistration>();
        for (const cmd of registration.commands ?? []) {
          if (!cmd || typeof cmd.name !== "string" || typeof cmd.execute !== "function") continue;
          const name = cmd.name.trim();
          if (!name) continue;
          if (!commandAllowed(manifest, name)) {
            this.opts.logger.warn("plugins.command_not_declared", {
              plugin_id: id,
              command: name,
            });
            continue;
          }
          commands.set(name, cmd);
        }

        this.plugins.set(id, {
          manifest,
          source_dir: pluginDir,
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
      }
    }
  }
}

