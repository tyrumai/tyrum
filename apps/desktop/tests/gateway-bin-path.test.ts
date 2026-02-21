import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false },
}));

import { resolveGatewayBinPath } from "../src/main/gateway-bin-path.js";

describe("resolveGatewayBinPath", () => {
  const moduleDir = join("/repo", "apps", "desktop", "dist", "main");
  const distGateway = join(
    "/repo",
    "apps",
    "desktop",
    "dist",
    "gateway",
    "index.mjs",
  );
  const monorepoGateway = join(
    "/repo",
    "packages",
    "gateway",
    "dist",
    "index.mjs",
  );
  const packagedGateway = join("/app/resources", "gateway", "index.mjs");

  it("uses packaged gateway when app is packaged", () => {
    const result = resolveGatewayBinPath({
      moduleDir,
      isPackaged: true,
      resourcesPath: "/app/resources",
      exists: (path) => path === packagedGateway,
    });

    expect(result).toBe(packagedGateway);
  });

  it("uses staged desktop gateway when available", () => {
    const result = resolveGatewayBinPath({
      moduleDir,
      isPackaged: false,
      exists: (path) => path === distGateway,
    });

    expect(result).toBe(distGateway);
  });

  it("falls back to monorepo gateway bundle", () => {
    const result = resolveGatewayBinPath({
      moduleDir,
      isPackaged: false,
      exists: (path) => path === monorepoGateway,
    });

    expect(result).toBe(monorepoGateway);
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
});
