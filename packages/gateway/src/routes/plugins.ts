/**
 * Plugin inventory routes — list loaded gateway plugins and expose scoped RPC routers.
 */

import type { Context } from "hono";
import { Hono } from "hono";
import type { AuthTokenClaims } from "@tyrum/schemas";
import type { PluginCatalogProvider } from "../modules/plugins/catalog-provider.js";
import type { PluginRegistry } from "../modules/plugins/registry.js";

export interface PluginRouteDeps {
  plugins?: PluginRegistry;
  pluginCatalogProvider?: PluginCatalogProvider;
}

async function resolvePluginRegistry(
  deps: PluginRouteDeps,
  tenantId?: string,
): Promise<PluginRegistry | undefined> {
  if (deps.pluginCatalogProvider) {
    if (tenantId) {
      return await deps.pluginCatalogProvider.loadTenantRegistry(tenantId);
    }
    return await deps.pluginCatalogProvider.loadGlobalRegistry();
  }
  return deps.plugins;
}

function resolveOptionalTenantId(c: { get: (key: string) => unknown }): string | undefined {
  const claims = c.get("authClaims") as AuthTokenClaims | undefined;
  const tenantId = claims?.tenant_id?.trim();
  return tenantId ? tenantId : undefined;
}

function rewritePluginRpcRequest(
  request: Request,
  originalPath: string,
  pluginId: string,
): Request {
  const basePath = `/plugins/${pluginId}/rpc`;
  const url = new URL(request.url);
  const nextPath =
    originalPath === basePath
      ? "/"
      : originalPath.startsWith(`${basePath}/`)
        ? originalPath.slice(basePath.length)
        : "/";
  url.pathname = nextPath;
  return new Request(url, request);
}

export function createPluginRoutes(deps: PluginRouteDeps): Hono {
  const app = new Hono();

  app.get("/plugins", async (c) => {
    const tenantId = resolveOptionalTenantId(c);
    const registry = await resolvePluginRegistry(deps, tenantId);
    return c.json({ status: "ok", plugins: registry?.list() ?? [] });
  });

  app.get("/plugins/:id", async (c) => {
    const tenantId = resolveOptionalTenantId(c);
    const registry = await resolvePluginRegistry(deps, tenantId);
    const id = c.req.param("id");
    if (!id) {
      return c.json({ error: "not_found", message: "plugin id is required" }, 404);
    }
    const manifest = registry?.getManifest(id);
    if (!manifest) {
      return c.json({ error: "not_found", message: `plugin '${id}' not found` }, 404);
    }
    return c.json({ status: "ok", plugin: manifest });
  });

  const handleRpc = async (c: Context) => {
    const tenantId = resolveOptionalTenantId(c);
    const registry = await resolvePluginRegistry(deps, tenantId);
    const pluginId = c.req.param("id");
    if (!pluginId) {
      return c.json({ error: "not_found", message: "plugin id is required" }, 404);
    }
    const router = registry?.getRouter(pluginId);
    if (!router) {
      return c.json({ error: "not_found", message: `plugin '${pluginId}' not found` }, 404);
    }
    const request = rewritePluginRpcRequest(c.req.raw, c.req.path, pluginId);
    return await router.fetch(request, c.env);
  };

  app.all("/plugins/:id/rpc", handleRpc);
  app.all("/plugins/:id/rpc/*", handleRpc);

  return app;
}
