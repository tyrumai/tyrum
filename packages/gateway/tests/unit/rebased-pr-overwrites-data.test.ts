import { describe, expect, it, vi } from "vitest";

const { spawnSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawnSync: spawnSyncMock,
  };
});

async function loadDataModule() {
  return import("../../../../scripts/report-rebased-pr-overwrites-data.mjs");
}

describe("rebased PR overwrite analyzer git ref resolution", () => {
  it("prefers the local origin base ref before falling back to GitHub", async () => {
    spawnSyncMock.mockReset();
    spawnSyncMock
      .mockReturnValueOnce({ status: 128, stdout: "", stderr: "unknown revision" })
      .mockReturnValueOnce({ status: 0, stdout: "abc123\n", stderr: "" });

    const { getRefOid } = await loadDataModule();

    expect(getRefOid("rhernaus", "tyrum", "main")).toBe("abc123");
    expect(spawnSyncMock.mock.calls).toEqual([
      ["git", ["rev-parse", "main"], expect.any(Object)],
      ["git", ["rev-parse", "origin/main"], expect.any(Object)],
    ]);
  });

  it("computes merge-base against the local origin ref when the plain branch ref is absent", async () => {
    spawnSyncMock.mockReset();
    spawnSyncMock
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "unknown revision" })
      .mockReturnValueOnce({ status: 0, stdout: "def456\n", stderr: "" });

    const { getMergeBase } = await loadDataModule();

    expect(getMergeBase("rhernaus", "tyrum", "main", "head789")).toBe("def456");
    expect(spawnSyncMock.mock.calls).toEqual([
      ["git", ["merge-base", "main", "head789"], expect.any(Object)],
      ["git", ["merge-base", "origin/main", "head789"], expect.any(Object)],
    ]);
  });
});
