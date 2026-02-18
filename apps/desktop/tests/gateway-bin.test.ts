import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false },
}));
import { resolveGatewayBinPath } from "../src/main/gateway-bin.js";

describe("resolveGatewayBinPath", () => {
  it("uses staged desktop gateway when available", () => {
    const bin = resolveGatewayBinPath("/tmp/base", (path) =>
      path.replaceAll("\\", "/").endsWith("/dist/gateway/index.mjs"),
    );
    expect(bin.replaceAll("\\", "/")).toMatch(/\/dist\/gateway\/index\.mjs$/);
  });

  it("falls back to monorepo dist/index.mjs when staged gateway does not exist", () => {
    const bin = resolveGatewayBinPath("/tmp/base", (path) =>
      path.replaceAll("\\", "/").endsWith("/packages/gateway/dist/index.mjs"),
    );
    expect(bin.replaceAll("\\", "/")).toMatch(
      /\/packages\/gateway\/dist\/index\.mjs$/,
    );
  });

  it("throws when no candidate exists", () => {
    expect(() => resolveGatewayBinPath("/tmp/base", () => false)).toThrow(
      "Unable to locate embedded gateway bundle",
    );
  });
});
