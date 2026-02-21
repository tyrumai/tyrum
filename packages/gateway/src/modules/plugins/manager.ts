import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginManifest as PluginManifestT, PluginToolDescriptor as PluginToolDescriptorT } from "@tyrum/schemas";
import { PluginManifest as PluginManifestSchema } from "@tyrum/schemas";
import type { ToolDescriptor } from "../agent/tools.js";
import type { TaggedContent } from "../agent/provenance.js";
import type { Logger } from "../observability/logger.js";

export type PluginToolHandlerResult =
  | { output: string; error?: string; provenance?: TaggedContent }
  | string;

export type PluginToolHandler = (args: unknown) => Promise<PluginToolHandlerResult>;

export interface LoadedPlugin {
  manifest: PluginManifestT;
  dir: string;
  loaded: boolean;
  error?: string;
}

function toToolDescriptor(tool: PluginToolDescriptorT): ToolDescriptor {
  return {
    id: tool.id,
    description: tool.description,
    risk: tool.risk,
    requires_confirmation: tool.requires_confirmation,
    keywords: tool.keywords,
    inputSchema: tool.input_schema,
  };
}

function normalizeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isValidPluginHandler(value: unknown): value is PluginToolHandler {
  return typeof value === "function";
}

export class PluginManager {
  private loaded = false;
  private plugins: LoadedPlugin[] = [];
  private toolDescriptors: ToolDescriptor[] = [];
  private toolHandlers: Map<string, PluginToolHandler> = new Map();

  constructor(
    private readonly pluginsDir: string,
    private readonly opts?: {
      enabled?: boolean;
      logger?: Logger;
      /** Tool ids that plugins must not override. */
      reservedToolIds?: ReadonlySet<string>;
    },
  ) {}

  isEnabled(): boolean {
    return Boolean(this.opts?.enabled);
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  listPlugins(): LoadedPlugin[] {
    return this.plugins.slice();
  }

  getToolDescriptors(): readonly ToolDescriptor[] {
    return this.toolDescriptors;
  }

  getToolHandlers(): ReadonlyMap<string, PluginToolHandler> {
    return this.toolHandlers;
  }

  async load(): Promise<void> {
    this.loaded = true;
    this.plugins = [];
    this.toolDescriptors = [];
    this.toolHandlers = new Map();

    if (!this.isEnabled()) {
      return;
    }

    let entries: Dirent<string>[] = [];
    try {
      entries = await readdir(this.pluginsDir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      // No plugins directory — treat as empty.
      return;
    }

    const reserved = this.opts?.reservedToolIds ?? new Set<string>();

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(this.pluginsDir, entry.name);
      const manifestPath = join(dir, "plugin.json");

      let manifest: PluginManifestT;
      try {
        const raw = await readFile(manifestPath, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        manifest = PluginManifestSchema.parse(parsed);
      } catch (err) {
        const message = normalizeError(err);
        this.opts?.logger?.warn("plugin.manifest_invalid", { dir, error: message });
        this.plugins.push({
          manifest: {
            id: entry.name,
            name: entry.name,
            version: "0.0.0",
            entrypoint: "./index.mjs",
            permissions: [],
            tools: [],
          },
          dir,
          loaded: false,
          error: message,
        });
        continue;
      }

      const entrypoint = resolve(dir, manifest.entrypoint || "./index.mjs");

      let mod: unknown;
      try {
        mod = await import(pathToFileURL(entrypoint).href);
      } catch (err) {
        const message = normalizeError(err);
        this.opts?.logger?.warn("plugin.load_failed", {
          plugin_id: manifest.id,
          entrypoint,
          error: message,
        });
        this.plugins.push({ manifest, dir, loaded: false, error: message });
        continue;
      }

      const handlers =
        (mod as { toolHandlers?: unknown }).toolHandlers ??
        (mod as { default?: { toolHandlers?: unknown } }).default?.toolHandlers;

      const record = handlers && typeof handlers === "object" ? (handlers as Record<string, unknown>) : {};

      let ok = true;
      const localHandlers = new Map<string, PluginToolHandler>();

      for (const tool of manifest.tools) {
        if (reserved.has(tool.id) || tool.id.startsWith("mcp.")) {
          ok = false;
          this.opts?.logger?.warn("plugin.tool_reserved", {
            plugin_id: manifest.id,
            tool_id: tool.id,
          });
          continue;
        }

        const h = record[tool.id];
        if (!isValidPluginHandler(h)) {
          ok = false;
          this.opts?.logger?.warn("plugin.handler_missing", {
            plugin_id: manifest.id,
            tool_id: tool.id,
          });
          continue;
        }

        if (this.toolHandlers.has(tool.id)) {
          ok = false;
          this.opts?.logger?.warn("plugin.tool_duplicate", {
            plugin_id: manifest.id,
            tool_id: tool.id,
          });
          continue;
        }

        localHandlers.set(tool.id, h);
      }

      if (!ok) {
        this.plugins.push({
          manifest,
          dir,
          loaded: false,
          error: "plugin handlers invalid or conflicting",
        });
        continue;
      }

      // Register tools.
      for (const tool of manifest.tools) {
        this.toolDescriptors.push(toToolDescriptor(tool));
      }
      for (const [id, handler] of localHandlers.entries()) {
        this.toolHandlers.set(id, handler);
      }

      this.plugins.push({ manifest, dir, loaded: true });
    }
  }
}
