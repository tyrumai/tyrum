import { describe, it, expect, vi } from "vitest";
import { PluginRegistry } from "../../src/modules/plugin/registry.js";
import type { LoadedPlugin } from "../../src/modules/plugin/loader.js";
import type { PluginInterface } from "../../src/modules/plugin/types.js";
import { Logger } from "../../src/modules/observability/logger.js";

function makeLogger(): Logger {
  return new Logger({ base: { service: "test" } });
}

function makePlugin(id: string): LoadedPlugin {
  return {
    manifest: {
      id,
      name: `Plugin ${id}`,
      version: "1.0.0",
      entry: "index.js",
      capabilities: [],
      permissions: [],
    },
    directory: `/tmp/plugins/${id}`,
    loaded_at: new Date().toISOString(),
  };
}

function makeInstance(): PluginInterface {
  return {
    onLoad: vi.fn().mockResolvedValue(undefined),
    onEnable: vi.fn().mockResolvedValue(undefined),
    onDisable: vi.fn().mockResolvedValue(undefined),
    onUnload: vi.fn().mockResolvedValue(undefined),
  };
}

describe("PluginRegistry", () => {
  it("register + list returns the plugin", () => {
    const registry = new PluginRegistry(makeLogger());
    const plugin = makePlugin("alpha");

    registry.registerWithInstance(plugin, makeInstance());

    const listed = registry.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.plugin.manifest.id).toBe("alpha");
    expect(listed[0]!.status).toBe("loaded");
  });

  it("enable changes status to enabled", async () => {
    const registry = new PluginRegistry(makeLogger());
    registry.registerWithInstance(makePlugin("beta"), makeInstance());

    const result = await registry.enable("beta");

    expect(result).toBe(true);
    expect(registry.get("beta")!.status).toBe("enabled");
  });

  it("enable returns false for unknown plugin", async () => {
    const registry = new PluginRegistry(makeLogger());

    expect(await registry.enable("nonexistent")).toBe(false);
  });

  it("disable changes status to disabled", async () => {
    const registry = new PluginRegistry(makeLogger());
    registry.registerWithInstance(makePlugin("gamma"), makeInstance());
    await registry.enable("gamma");

    const result = await registry.disable("gamma");

    expect(result).toBe(true);
    expect(registry.get("gamma")!.status).toBe("disabled");
  });

  it("disable returns false for unknown plugin", async () => {
    const registry = new PluginRegistry(makeLogger());

    expect(await registry.disable("nonexistent")).toBe(false);
  });

  it("unload removes the plugin", async () => {
    const registry = new PluginRegistry(makeLogger());
    registry.registerWithInstance(makePlugin("delta"), makeInstance());

    const result = await registry.unload("delta");

    expect(result).toBe(true);
    expect(registry.get("delta")).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it("unload returns false for unknown plugin", async () => {
    const registry = new PluginRegistry(makeLogger());

    expect(await registry.unload("nonexistent")).toBe(false);
  });

  it("get returns entry by ID", () => {
    const registry = new PluginRegistry(makeLogger());
    registry.registerWithInstance(makePlugin("epsilon"), makeInstance());

    const entry = registry.get("epsilon");

    expect(entry).toBeDefined();
    expect(entry!.plugin.manifest.id).toBe("epsilon");
  });

  it("get returns undefined for unknown ID", () => {
    const registry = new PluginRegistry(makeLogger());

    expect(registry.get("unknown")).toBeUndefined();
  });

  it("listEnabled only returns enabled plugins", async () => {
    const registry = new PluginRegistry(makeLogger());
    registry.registerWithInstance(makePlugin("a"), makeInstance());
    registry.registerWithInstance(makePlugin("b"), makeInstance());
    registry.registerWithInstance(makePlugin("c"), makeInstance());

    await registry.enable("a");
    await registry.enable("c");

    const enabled = registry.listEnabled();
    expect(enabled).toHaveLength(2);
    const ids = enabled.map(e => e.plugin.manifest.id);
    expect(ids).toContain("a");
    expect(ids).toContain("c");
    expect(ids).not.toContain("b");
  });

  it("size property reflects registered count", async () => {
    const registry = new PluginRegistry(makeLogger());

    expect(registry.size).toBe(0);

    registry.registerWithInstance(makePlugin("x"), makeInstance());
    registry.registerWithInstance(makePlugin("y"), makeInstance());

    expect(registry.size).toBe(2);

    await registry.unload("x");

    expect(registry.size).toBe(1);
  });
});
