import { Hono } from "hono";
import type { PluginManager } from "../modules/plugins/manager.js";

export function createPluginRoutes(pluginManager?: PluginManager): Hono {
  const app = new Hono();

  app.get("/plugins", (c) => {
    const plugins = pluginManager?.listPlugins() ?? [];
    return c.json({
      ok: true,
      enabled: pluginManager?.isEnabled() ?? false,
      loaded: pluginManager?.isLoaded() ?? false,
      plugins: plugins.map((p) => ({
        ...p.manifest,
        loaded: p.loaded,
        error: p.error,
      })),
    });
  });

  return app;
}

