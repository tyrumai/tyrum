import { describe, it, expect } from "vitest";
import { PluginRegistry } from "../../src/modules/plugin/registry.js";
import type { LoadedPlugin } from "../../src/modules/plugin/loader.js";

function makePlugin(id: string): LoadedPlugin {
  return {
    manifest: {
      id,
      name: `Plugin ${id}`,
      version: "1.0.0",
    },
    directory: `/tmp/plugins/${id}`,
    loaded_at: new Date().toISOString(),
  };
}

describe("PluginRegistry", () => {
  it("register + list returns the plugin", () => {
    const registry = new PluginRegistry();
    const plugin = makePlugin("alpha");

    registry.register(plugin);

    const listed = registry.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.plugin.manifest.id).toBe("alpha");
    expect(listed[0]!.status).toBe("loaded");
  });

  it("enable changes status to enabled", () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin("beta"));

    const result = registry.enable("beta");

    expect(result).toBe(true);
    expect(registry.get("beta")!.status).toBe("enabled");
  });

  it("enable returns false for unknown plugin", () => {
    const registry = new PluginRegistry();

    expect(registry.enable("nonexistent")).toBe(false);
  });

  it("disable changes status to disabled", () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin("gamma"));
    registry.enable("gamma");

    const result = registry.disable("gamma");

    expect(result).toBe(true);
    expect(registry.get("gamma")!.status).toBe("disabled");
  });

  it("disable returns false for unknown plugin", () => {
    const registry = new PluginRegistry();

    expect(registry.disable("nonexistent")).toBe(false);
  });

  it("unload removes the plugin", () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin("delta"));

    const result = registry.unload("delta");

    expect(result).toBe(true);
    expect(registry.get("delta")).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it("unload returns false for unknown plugin", () => {
    const registry = new PluginRegistry();

    expect(registry.unload("nonexistent")).toBe(false);
  });

  it("get returns entry by ID", () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin("epsilon"));

    const entry = registry.get("epsilon");

    expect(entry).toBeDefined();
    expect(entry!.plugin.manifest.id).toBe("epsilon");
  });

  it("get returns undefined for unknown ID", () => {
    const registry = new PluginRegistry();

    expect(registry.get("unknown")).toBeUndefined();
  });

  it("listEnabled only returns enabled plugins", () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin("a"));
    registry.register(makePlugin("b"));
    registry.register(makePlugin("c"));

    registry.enable("a");
    registry.enable("c");

    const enabled = registry.listEnabled();
    expect(enabled).toHaveLength(2);
    const ids = enabled.map(e => e.plugin.manifest.id);
    expect(ids).toContain("a");
    expect(ids).toContain("c");
    expect(ids).not.toContain("b");
  });

  it("size property reflects registered count", () => {
    const registry = new PluginRegistry();

    expect(registry.size).toBe(0);

    registry.register(makePlugin("x"));
    registry.register(makePlugin("y"));

    expect(registry.size).toBe(2);

    registry.unload("x");

    expect(registry.size).toBe(1);
  });
});
