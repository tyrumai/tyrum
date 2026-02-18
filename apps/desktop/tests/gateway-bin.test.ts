import { describe, expect, it } from "vitest";
import { resolveGatewayBinPath } from "../src/main/gateway-bin.js";

describe("resolveGatewayBinPath", () => {
  it("prefers dist/index.js when both js and mjs exist", () => {
    const bin = resolveGatewayBinPath("/tmp/base", (path) =>
      path.endsWith("/index.js") || path.endsWith("/index.mjs"),
    );
    expect(bin).toMatch(/\/packages\/gateway\/dist\/index\.js$/);
  });

  it("falls back to dist/index.mjs when js does not exist", () => {
    const bin = resolveGatewayBinPath("/tmp/base", (path) =>
      path.endsWith("/index.mjs"),
    );
    expect(bin).toMatch(/\/packages\/gateway\/dist\/index\.mjs$/);
  });
});
