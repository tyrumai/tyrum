import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { gatewayApiManifest } from "../../src/api/manifest.js";

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "ALL"]);

function normalizePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/gu, "{param}").replace(/\{[^}]+\}/gu, "{param}");
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizePath(path)}`;
}

describe("Gateway API manifest", () => {
  it("covers the registered HTTP route surface", async () => {
    const { app } = await createTestApp();
    const routes =
      (app as unknown as { routes?: Array<{ method: string; path: string }> }).routes ?? [];

    const actual = routes
      .filter((route) => HTTP_METHODS.has(route.method.toUpperCase()))
      .filter((route) => route.method.toUpperCase() !== "ALL" || route.path.startsWith("/plugins/"))
      .map((route) => routeKey(route.method, route.path))
      .toSorted();
    const expected = new Set(
      gatewayApiManifest.http.map((operation) => routeKey(operation.method, operation.path)),
    );

    expect(actual.every((route) => expected.has(route))).toBe(true);
  });
});
