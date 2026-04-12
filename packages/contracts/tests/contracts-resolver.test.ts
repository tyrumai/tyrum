import { beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.hoisted(() => vi.fn());
const spawnSync = vi.hoisted(() => vi.fn(() => ({ status: 0 })));

vi.mock("node:fs/promises", () => ({
  readFile,
}));

vi.mock("node:child_process", () => ({
  spawnSync,
}));

describe("contracts API resolver", () => {
  beforeEach(() => {
    vi.resetModules();
    readFile.mockReset().mockResolvedValue(
      JSON.stringify({
        format: "tyrum.contracts.jsonschema.catalog.v1",
        package: {
          name: "@tyrum/contracts",
        },
      }),
    );
    spawnSync.mockReset().mockReturnValue({ status: 0 });
  });

  it("rebuilds @tyrum/contracts before reading the published catalog", async () => {
    const { readContractsCatalog } = await import("../../../scripts/api/contracts-resolver.mjs");

    const catalog = await readContractsCatalog();

    expect(spawnSync).toHaveBeenCalledOnce();
    expect(readFile).toHaveBeenCalledOnce();
    expect(catalog).toMatchObject({
      format: "tyrum.contracts.jsonschema.catalog.v1",
      package: {
        name: "@tyrum/contracts",
      },
    });
  });
});
