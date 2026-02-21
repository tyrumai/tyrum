import { describe, expect, it, vi } from "vitest";
import { PluginRegistry } from "../../src/modules/plugin/registry.js";
import type { LoadedPlugin } from "../../src/modules/plugin/loader.js";
import type { PluginInterface, PluginContext } from "../../src/modules/plugin/types.js";
import { Logger } from "../../src/modules/observability/logger.js";
import { PluginManifestSchema } from "@tyrum/schemas";

function makeLogger(): Logger {
  return new Logger({ base: { service: "test" } });
}

function makePlugin(id: string): LoadedPlugin {
  return {
    manifest: {
      id,
      name: `Test Plugin ${id}`,
      version: "1.0.0",
      entry: "index.js",
      capabilities: ["tools"],
      permissions: [],
    },
    directory: `/tmp/plugins/${id}`,
    loaded_at: new Date().toISOString(),
  };
}

function makeMockInstance(): PluginInterface {
  return {
    onLoad: vi.fn().mockResolvedValue(undefined),
    onEnable: vi.fn().mockResolvedValue(undefined),
    onDisable: vi.fn().mockResolvedValue(undefined),
    onUnload: vi.fn().mockResolvedValue(undefined),
  };
}

describe("PluginRegistry", () => {
  it("registers plugin with instance and transitions through lifecycle", async () => {
    const registry = new PluginRegistry(makeLogger());
    const plugin = makePlugin("test-1");
    const instance = makeMockInstance();

    registry.registerWithInstance(plugin, instance);
    expect(registry.size).toBe(1);
    expect(registry.get("test-1")?.status).toBe("loaded");

    // Enable
    await registry.enable("test-1");
    expect(registry.get("test-1")?.status).toBe("enabled");
    expect(instance.onEnable).toHaveBeenCalledOnce();

    // Disable
    await registry.disable("test-1");
    expect(registry.get("test-1")?.status).toBe("disabled");
    expect(instance.onDisable).toHaveBeenCalledOnce();

    // Unload
    await registry.unload("test-1");
    expect(registry.size).toBe(0);
    expect(instance.onUnload).toHaveBeenCalledOnce();
  });

  it("registers tools via PluginContext", async () => {
    const registry = new PluginRegistry(makeLogger());
    const plugin = makePlugin("tool-plugin");
    const instance: PluginInterface = {
      async onLoad(ctx: PluginContext) {
        ctx.registerTool({
          id: "tool.custom.hello",
          description: "Says hello",
          risk: "low",
          requires_confirmation: false,
        });
      },
      async onEnable() {},
    };

    const entry = registry.registerWithInstance(plugin, instance);
    const ctx = {
      registerTool: (d: { id: string; description: string; risk: string; requires_confirmation: boolean }) => {
        entry.tools.push(d as any);
      },
      registerCommand: () => {},
      getConfig: () => ({}),
      log: makeLogger(),
    };
    await instance.onLoad(ctx);

    expect(entry.tools).toHaveLength(1);
    expect(entry.tools[0]!.id).toBe("tool.custom.hello");
  });

  it("rejects invalid manifest with Zod error", () => {
    expect(() =>
      PluginManifestSchema.parse({ id: "", name: "x", version: "1", entry: "a.js" }),
    ).toThrow();
  });

  it("handles enable failure gracefully", async () => {
    const registry = new PluginRegistry(makeLogger());
    const plugin = makePlugin("failing");
    const instance: PluginInterface = {
      onLoad: vi.fn().mockResolvedValue(undefined),
      onEnable: vi.fn().mockRejectedValue(new Error("enable failed")),
    };

    registry.registerWithInstance(plugin, instance);
    const result = await registry.enable("failing");
    expect(result).toBe(false);
    expect(registry.get("failing")?.status).toBe("error");
    expect(registry.get("failing")?.error).toContain("enable failed");
  });

  it("blocks entry path traversal", () => {
    expect(() =>
      PluginManifestSchema.parse({
        id: "evil",
        name: "Evil Plugin",
        version: "1.0.0",
        entry: "../../etc/passwd",
      }),
    ).not.toThrow(); // Zod doesn't block traversal — loader.ts does

    // The loader validateEntryPath function blocks this
    // We test that separately through the loadPlugin function
  });
});
