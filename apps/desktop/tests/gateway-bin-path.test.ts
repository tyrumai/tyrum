import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false },
}));

import { resolveGatewayBin, resolveGatewayBinPath } from "../src/main/gateway-bin-path.js";

describe("resolveGatewayBinPath", () => {
  const moduleDir = join("/repo", "apps", "desktop", "dist", "main");
  const distGateway = join("/repo", "apps", "desktop", "dist", "gateway", "index.mjs");
  const monorepoGateway = join("/repo", "packages", "gateway", "dist", "index.mjs");
  const packagedGateway = join("/app/resources", "app.asar", "dist", "gateway", "index.mjs");
  const packagedResourceGateway = join("/app/resources", "gateway", "index.mjs");

  it("prefers the asar-packaged gateway when app is packaged", () => {
    const result = resolveGatewayBin({
      moduleDir,
      isPackaged: true,
      resourcesPath: "/app/resources",
      exists: (path) => path === packagedGateway,
    });

    expect(result).toEqual({ path: packagedGateway, source: "packaged" });
  });

  it("falls back to the extraResources packaged gateway when needed", () => {
    const result = resolveGatewayBin({
      moduleDir,
      isPackaged: true,
      resourcesPath: "/app/resources",
      exists: (path) => path === packagedResourceGateway,
    });

    expect(result).toEqual({ path: packagedResourceGateway, source: "packaged" });
  });

  it("uses staged desktop gateway when available", () => {
    const result = resolveGatewayBin({
      moduleDir,
      isPackaged: false,
      exists: (path) => path === distGateway,
    });

    expect(result).toEqual({ path: distGateway, source: "staged" });
  });

  it("falls back to monorepo gateway bundle", () => {
    const result = resolveGatewayBin({
      moduleDir,
      isPackaged: false,
      exists: (path) => path === monorepoGateway,
    });

    expect(result).toEqual({ path: monorepoGateway, source: "monorepo" });
  });

  it("throws a useful error when no candidate exists", () => {
    expect(() =>
      resolveGatewayBinPath({
        moduleDir,
        isPackaged: false,
        exists: () => false,
      }),
    ).toThrow("Unable to locate embedded gateway bundle");
  });

  it("keeps resolveGatewayBinPath for callers that only need the path", () => {
    const result = resolveGatewayBinPath({
      moduleDir,
      isPackaged: false,
      exists: (path) => path === distGateway,
    });

    expect(result).toBe(distGateway);
  });
});
