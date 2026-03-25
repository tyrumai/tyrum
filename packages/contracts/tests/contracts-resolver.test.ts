import { describe, expect, it, vi } from "vitest";

const spawnSync = vi.hoisted(() => vi.fn(() => ({ status: 0 })));

vi.mock("node:child_process", () => ({
  spawnSync,
}));

describe("contracts API resolver", () => {
  it("rebuilds @tyrum/contracts before reading the published catalog", async () => {
    const { readContractsCatalog } = await import("../../../scripts/api/contracts-resolver.mjs");

    const catalog = await readContractsCatalog();

    expect(spawnSync).toHaveBeenCalledOnce();
    expect(catalog).toMatchObject({
      format: "tyrum.contracts.jsonschema.catalog.v1",
      package: {
        name: "@tyrum/contracts",
      },
    });
  });
});
