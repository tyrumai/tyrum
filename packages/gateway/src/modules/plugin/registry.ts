import type { LoadedPlugin } from "./loader.js";
import { loadPluginCode } from "./loader.js";
import type {
  PluginInterface,
  PluginContext,
  ToolDescriptor,
  CommandHandler,
} from "./types.js";
import type { Logger } from "../observability/logger.js";

export type PluginStatus = "loaded" | "enabled" | "disabled" | "error";

export interface PluginEntry {
  plugin: LoadedPlugin;
  instance?: PluginInterface;
  status: PluginStatus;
  error?: string;
  tools: ToolDescriptor[];
  commands: Map<string, CommandHandler>;
}

function createPluginContext(
  entry: PluginEntry,
  logger: Logger,
): PluginContext {
  return {
    registerTool(descriptor: ToolDescriptor): void {
      entry.tools.push(descriptor);
    },
    registerCommand(name: string, handler: CommandHandler): void {
      entry.commands.set(name, handler);
    },
    getConfig(): Record<string, unknown> {
      return {
        id: entry.plugin.manifest.id,
        name: entry.plugin.manifest.name,
        version: entry.plugin.manifest.version,
        capabilities: entry.plugin.manifest.capabilities,
        permissions: entry.plugin.manifest.permissions,
      };
    },
    log: logger,
  };
}

export class PluginRegistry {
  private readonly plugins = new Map<string, PluginEntry>();

  constructor(private readonly logger: Logger) {}

  /** Register and load a plugin (loads code, calls onLoad). */
  async register(plugin: LoadedPlugin): Promise<void> {
    const entry: PluginEntry = {
      plugin,
      status: "loaded",
      tools: [],
      commands: new Map(),
    };

    try {
      const instance = await loadPluginCode(plugin.directory, plugin.manifest);
      entry.instance = instance;

      const ctx = createPluginContext(entry, this.logger);
      await instance.onLoad(ctx);

      this.plugins.set(plugin.manifest.id, entry);
    } catch (err) {
      entry.status = "error";
      entry.error = err instanceof Error ? err.message : String(err);
      this.plugins.set(plugin.manifest.id, entry);
      this.logger.warn("plugin.register.failed", {
        plugin_id: plugin.manifest.id,
        error: entry.error,
      });
    }
  }

  /** Register a plugin with a pre-created instance (for testing). */
  registerWithInstance(plugin: LoadedPlugin, instance: PluginInterface): PluginEntry {
    const entry: PluginEntry = {
      plugin,
      instance,
      status: "loaded",
      tools: [],
      commands: new Map(),
    };
    this.plugins.set(plugin.manifest.id, entry);
    return entry;
  }

  /** Enable a plugin by ID. */
  async enable(pluginId: string): Promise<boolean> {
    const entry = this.plugins.get(pluginId);
    if (!entry || !entry.instance) return false;

    try {
      if (entry.instance.onEnable) {
        const ctx = createPluginContext(entry, this.logger);
        await entry.instance.onEnable(ctx);
      }
      entry.status = "enabled";
      return true;
    } catch (err) {
      entry.status = "error";
      entry.error = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  /** Disable a plugin by ID. */
  async disable(pluginId: string): Promise<boolean> {
    const entry = this.plugins.get(pluginId);
    if (!entry || !entry.instance) return false;

    try {
      if (entry.instance.onDisable) {
        const ctx = createPluginContext(entry, this.logger);
        await entry.instance.onDisable(ctx);
      }
      entry.status = "disabled";
      return true;
    } catch (err) {
      entry.status = "error";
      entry.error = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  /** Unload (remove) a plugin. */
  async unload(pluginId: string): Promise<boolean> {
    const entry = this.plugins.get(pluginId);
    if (!entry) return false;

    try {
      if (entry.instance?.onUnload) {
        await entry.instance.onUnload();
      }
    } catch {
      // Unload errors are non-fatal
    }

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
    return this.list().filter((e) => e.status === "enabled");
  }

  /** Get all tools registered by enabled plugins. */
  getRegisteredTools(): ToolDescriptor[] {
    return this.listEnabled().flatMap((e) => e.tools);
  }

  /** Get count of registered plugins. */
  get size(): number {
    return this.plugins.size;
  }
}
