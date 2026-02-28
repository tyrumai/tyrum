import type { Context } from "hono";
import { matchedRoutes } from "hono/route";

export function getLeafHonoRoutePath(c: Context): string | undefined {
  try {
    const routes = matchedRoutes(c);
    if (!Array.isArray(routes) || routes.length === 0) return undefined;

    // Filter out "*" middleware routes and pick the last concrete route.
    const concrete = routes.filter((route) => typeof route.path === "string" && route.path !== "*");
    const leaf = concrete.at(-1);
    return typeof leaf?.path === "string" ? leaf.path : undefined;
  } catch (error) {
    void error;
    return undefined;
  }
}

export function resolveHonoRoutePath(c: Context): string {
  return getLeafHonoRoutePath(c) ?? c.req.path;
}
