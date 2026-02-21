import { Hono } from "hono";
import type { PluginRegistry } from "../modules/plugin/registry.js";

export interface PluginRouteDeps {
  pluginRegistry: PluginRegistry;
}

export function createPluginRoutes(deps: PluginRouteDeps): Hono {
  const app = new Hono();

  // GET /plugins -- list all plugins
  app.get("/plugins", (c) => {
    const plugins = deps.pluginRegistry.list().map((e) => ({
      id: e.plugin.manifest.id,
      name: e.plugin.manifest.name,
      version: e.plugin.manifest.version,
      description: e.plugin.manifest.description ?? null,
      capabilities: e.plugin.manifest.capabilities,
      status: e.status,
      error: e.error ?? null,
      tools: e.tools.length,
      commands: e.commands.size,
      loaded_at: e.plugin.loaded_at,
    }));
    return c.json({ plugins });
  });

  // POST /plugins/:id/enable -- enable a plugin
  app.post("/plugins/:id/enable", async (c) => {
    const id = c.req.param("id");
    const success = await deps.pluginRegistry.enable(id);
    if (!success) {
      return c.json({ error: "not_found", message: `Plugin '${id}' not found or has no instance` }, 404);
    }
    return c.json({ enabled: true, plugin_id: id });
  });

  // POST /plugins/:id/disable -- disable a plugin
  app.post("/plugins/:id/disable", async (c) => {
    const id = c.req.param("id");
    const success = await deps.pluginRegistry.disable(id);
    if (!success) {
      return c.json({ error: "not_found", message: `Plugin '${id}' not found or has no instance` }, 404);
    }
    return c.json({ disabled: true, plugin_id: id });
  });

  // DELETE /plugins/:id -- unload a plugin
  app.delete("/plugins/:id", async (c) => {
    const id = c.req.param("id");
    const success = await deps.pluginRegistry.unload(id);
    if (!success) {
      return c.json({ error: "not_found", message: `Plugin '${id}' not found` }, 404);
    }
    return c.json({ unloaded: true, plugin_id: id });
  });

  return app;
}
