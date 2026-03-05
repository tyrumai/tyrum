import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveGatewayEntrypointPath } from "../../src/bootstrap/entrypoint-path.js";

const runtimeModuleUrl = new URL("../../src/bootstrap/runtime.ts", import.meta.url).href;

describe("resolveGatewayEntrypointPath", () => {
  it("prefers the packaged dist entrypoint when present", () => {
    const resolved = resolveGatewayEntrypointPath(runtimeModuleUrl, (path) => {
      return path.endsWith("/index.mjs");
    });

    expect(resolved).toBe(fileURLToPath(new URL("../../src/index.mjs", import.meta.url)));
  });

  it("falls back to the source entrypoint when only TypeScript sources exist", () => {
    const resolved = resolveGatewayEntrypointPath(runtimeModuleUrl, (path) => {
      return path.endsWith("/index.ts");
    });

    expect(resolved).toBe(fileURLToPath(new URL("../../src/index.ts", import.meta.url)));
  });
});
