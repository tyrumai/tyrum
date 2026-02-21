import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createPluginRoutes } from "../../src/routes/plugin.js";

describe("plugin routes", () => {
  const sampleEntry = {
    plugin: {
      manifest: {
        id: "plugin-alpha",
        name: "Alpha Plugin",
        version: "1.2.0",
        description: "A test plugin",
        capabilities: ["tools", "commands"],
      },
      loaded_at: "2025-06-01T00:00:00Z",
    },
    status: "active",
    error: undefined,
    tools: [{ name: "tool-a" }, { name: "tool-b" }],
    commands: new Map([["cmd-a", {}]]),
  };

  function setup(overrides: {
    list?: unknown[];
    enable?: boolean;
    disable?: boolean;
    unload?: boolean;
  } = {}) {
    const pluginRegistry = {
      list: vi.fn().mockReturnValue(overrides.list ?? [sampleEntry]),
      enable: vi.fn().mockResolvedValue(overrides.enable ?? true),
      disable: vi.fn().mockResolvedValue(overrides.disable ?? true),
      unload: vi.fn().mockResolvedValue(overrides.unload ?? true),
    };
    const app = new Hono();
    app.route("/", createPluginRoutes({ pluginRegistry } as never));
    return { app, pluginRegistry };
  }

  // --- GET /plugins ---

  it("GET /plugins returns formatted plugin list", async () => {
    const { app } = setup();
    const res = await app.request("/plugins");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plugins: Array<{
        id: string;
        name: string;
        version: string;
        description: string | null;
        capabilities: string[];
        status: string;
        error: string | null;
        tools: number;
        commands: number;
        loaded_at: string;
      }>;
    };
    expect(body.plugins).toHaveLength(1);
    const p = body.plugins[0]!;
    expect(p.id).toBe("plugin-alpha");
    expect(p.name).toBe("Alpha Plugin");
    expect(p.version).toBe("1.2.0");
    expect(p.description).toBe("A test plugin");
    expect(p.capabilities).toEqual(["tools", "commands"]);
    expect(p.status).toBe("active");
    expect(p.error).toBeNull();
    expect(p.tools).toBe(2);
    expect(p.commands).toBe(1);
    expect(p.loaded_at).toBe("2025-06-01T00:00:00Z");
  });

  it("GET /plugins returns empty list when no plugins loaded", async () => {
    const { app } = setup({ list: [] });
    const res = await app.request("/plugins");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plugins: unknown[] };
    expect(body.plugins).toEqual([]);
  });

  // --- POST /plugins/:id/enable ---

  it("POST /plugins/:id/enable enables plugin", async () => {
    const { app, pluginRegistry } = setup();
    const res = await app.request("/plugins/plugin-alpha/enable", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; plugin_id: string };
    expect(body.enabled).toBe(true);
    expect(body.plugin_id).toBe("plugin-alpha");
    expect(pluginRegistry.enable).toHaveBeenCalledWith("plugin-alpha");
  });

  it("POST /plugins/:id/enable returns 404 when not found", async () => {
    const { app } = setup({ enable: false });
    const res = await app.request("/plugins/unknown/enable", { method: "POST" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  // --- POST /plugins/:id/disable ---

  it("POST /plugins/:id/disable disables plugin", async () => {
    const { app, pluginRegistry } = setup();
    const res = await app.request("/plugins/plugin-alpha/disable", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { disabled: boolean; plugin_id: string };
    expect(body.disabled).toBe(true);
    expect(body.plugin_id).toBe("plugin-alpha");
    expect(pluginRegistry.disable).toHaveBeenCalledWith("plugin-alpha");
  });

  it("POST /plugins/:id/disable returns 404 when not found", async () => {
    const { app } = setup({ disable: false });
    const res = await app.request("/plugins/unknown/disable", { method: "POST" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  // --- DELETE /plugins/:id ---

  it("DELETE /plugins/:id unloads plugin", async () => {
    const { app, pluginRegistry } = setup();
    const res = await app.request("/plugins/plugin-alpha", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unloaded: boolean; plugin_id: string };
    expect(body.unloaded).toBe(true);
    expect(body.plugin_id).toBe("plugin-alpha");
    expect(pluginRegistry.unload).toHaveBeenCalledWith("plugin-alpha");
  });

  it("DELETE /plugins/:id returns 404 when not found", async () => {
    const { app } = setup({ unload: false });
    const res = await app.request("/plugins/unknown", { method: "DELETE" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});
