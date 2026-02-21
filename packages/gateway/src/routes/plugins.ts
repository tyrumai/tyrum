/**
 * Plugin inventory routes — list loaded gateway plugins and expose scoped RPC routers.
 */

import { Hono } from "hono";
import type { PluginRegistry } from "../modules/plugins/registry.js";

export interface PluginRouteDeps {
  plugins: PluginRegistry;
}

export function createPluginRoutes(deps: PluginRouteDeps): Hono {
  const app = new Hono();

  app.get("/plugins", (c) => {
    return c.json({ status: "ok", plugins: deps.plugins.list() });
  });

  app.get("/plugins/:id", (c) => {
    const id = c.req.param("id");
    const manifest = deps.plugins.getManifest(id);
    if (!manifest) {
      return c.json({ error: "not_found", message: `plugin '${id}' not found` }, 404);
    }
    return c.json({ status: "ok", plugin: manifest });
  });

  // Scoped plugin routers. Plugins register relative routes and are mounted under:
  //   /plugins/<plugin_id>/rpc/*
  for (const { pluginId, router } of deps.plugins.routers()) {
    app.route(`/plugins/${pluginId}/rpc`, router);
  }

  return app;
}

