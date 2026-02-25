import { describe, expect, it, vi } from "vitest";
import { runShutdownCleanup } from "../../src/index.js";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("runShutdownCleanup", () => {
  it("closes the database after cleanup tasks settle", async () => {
    const workerDone = createDeferred();
    const closeDb = vi.fn(async () => {});

    const cleanup = runShutdownCleanup([Promise.resolve(), workerDone.promise], closeDb);

    await Promise.resolve();
    expect(closeDb).not.toHaveBeenCalled();

    workerDone.resolve();
    await cleanup;

    expect(closeDb).toHaveBeenCalledTimes(1);
  });

  it("does not reject when cleanup tasks or db close fail", async () => {
    const closeDb = vi.fn(async () => {
      throw new Error("db close failed");
    });

    await expect(
      runShutdownCleanup([Promise.reject(new Error("cleanup failed"))], closeDb),
    ).resolves.toBeUndefined();
    expect(closeDb).toHaveBeenCalledTimes(1);
  });
});
