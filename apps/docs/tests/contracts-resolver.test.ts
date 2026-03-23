import { beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.fn();
const delay = vi.fn().mockResolvedValue(undefined);

vi.mock("node:fs/promises", () => ({
  readFile,
}));

vi.mock("node:timers/promises", () => ({
  setTimeout: delay,
}));

describe("contracts-resolver", () => {
  beforeEach(() => {
    vi.resetModules();
    readFile.mockReset();
    delay.mockReset().mockResolvedValue(undefined);
  });

  it("retries transient missing contract artifacts", async () => {
    const missingError = Object.assign(new Error("missing"), { code: "ENOENT" });
    readFile
      .mockRejectedValueOnce(missingError)
      .mockResolvedValueOnce(JSON.stringify({ schemas: [] }));

    const { readContractsCatalog } = await import("../../../scripts/api/contracts-resolver.mjs");

    await expect(readContractsCatalog()).resolves.toEqual({ schemas: [] });
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });
});
