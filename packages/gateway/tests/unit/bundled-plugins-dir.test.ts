import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBundledPluginsDirFrom } from "../../src/modules/plugins/registry.js";

describe("resolveBundledPluginsDirFrom", () => {
  it("resolves correctly from a dist/ bundle location", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const gatewayRoot = dirname(dirname(here));
    const fromDist = resolveBundledPluginsDirFrom(join(gatewayRoot, "dist"));
    expect(fromDist).toBe(join(gatewayRoot, "plugins"));
  });

  it("does not confuse src/modules/plugins with the bundled plugins directory", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const gatewayRoot = dirname(dirname(here));
    const fromSource = resolveBundledPluginsDirFrom(join(gatewayRoot, "src", "modules", "plugins"));
    expect(fromSource).toBe(join(gatewayRoot, "plugins"));
  });
});

