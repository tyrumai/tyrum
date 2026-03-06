import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveGatewayEntrypointPath } from "../../src/bootstrap/entrypoint-path.js";

const runtimeModuleUrl = new URL("../../src/bootstrap/runtime.ts", import.meta.url).href;

describe("resolveGatewayEntrypointPath", () => {
  it("prefers the running gateway process entrypoint when available", () => {
    const resolved = resolveGatewayEntrypointPath(
      "/app/packages/gateway/dist/index.mjs",
      runtimeModuleUrl,
      (path) => path === "/app/packages/gateway/dist/index.mjs",
    );

    expect(resolved).toBe("/app/packages/gateway/dist/index.mjs");
  });

  it("prefers the running gateway cli launcher when available", () => {
    const resolved = resolveGatewayEntrypointPath(
      "/app/packages/gateway/bin/tyrum.mjs",
      runtimeModuleUrl,
      (path) => path === "/app/packages/gateway/bin/tyrum.mjs",
    );

    expect(resolved).toBe("/app/packages/gateway/bin/tyrum.mjs");
  });

  it("prefers the packaged dist entrypoint when present", () => {
    const resolved = resolveGatewayEntrypointPath(undefined, runtimeModuleUrl, (path) => {
      return path.endsWith("/index.mjs");
    });

    expect(resolved).toBe(fileURLToPath(new URL("../../src/index.mjs", import.meta.url)));
  });

  it("falls back to the source entrypoint when only TypeScript sources exist", () => {
    const resolved = resolveGatewayEntrypointPath(undefined, runtimeModuleUrl, (path) => {
      return path.endsWith("/index.ts");
    });

    expect(resolved).toBe(fileURLToPath(new URL("../../src/index.ts", import.meta.url)));
  });
});
