import type { LoadedPlugin } from "./loader.js";

export type PluginStatus = "loaded" | "enabled" | "disabled" | "error";

export interface PluginEntry {
  plugin: LoadedPlugin;
  status: PluginStatus;
  error?: string;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, PluginEntry>();

  /** Register a loaded plugin. */
  register(plugin: LoadedPlugin): void {
    this.plugins.set(plugin.manifest.id, {
      plugin,
      status: "loaded",
    });
  }

  /** Enable a plugin by ID. */
  enable(pluginId: string): boolean {
    const entry = this.plugins.get(pluginId);
    if (!entry) return false;
    entry.status = "enabled";
    return true;
  }

  /** Disable a plugin by ID. */
  disable(pluginId: string): boolean {
    const entry = this.plugins.get(pluginId);
    if (!entry) return false;
    entry.status = "disabled";
    return true;
  }

  /** Unload (remove) a plugin. */
  unload(pluginId: string): boolean {
    return this.plugins.delete(pluginId);
  }

  /** Get a plugin entry by ID. */
  get(pluginId: string): PluginEntry | undefined {
    return this.plugins.get(pluginId);
  }

  /** List all registered plugins. */
  list(): PluginEntry[] {
    return Array.from(this.plugins.values());
  }

  /** List only enabled plugins. */
  listEnabled(): PluginEntry[] {
    return this.list().filter(e => e.status === "enabled");
  }

  /** Get count of registered plugins. */
  get size(): number {
    return this.plugins.size;
  }
}
