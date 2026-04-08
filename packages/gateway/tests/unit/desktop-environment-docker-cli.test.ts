import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileAsyncMock, execFileMock } = vi.hoisted(() => {
  const asyncMock = vi.fn();
  const callbackMock = vi.fn();
  Object.assign(callbackMock, {
    [Symbol.for("nodejs.util.promisify.custom")]: asyncMock,
  });
  return {
    execFileAsyncMock: asyncMock,
    execFileMock: callbackMock,
  };
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFile: execFileMock,
  };
});

import { ensureImageAvailable } from "../../src/modules/desktop-environments/docker-cli.js";

function rejectExec(
  stderr: string,
  options?: { message?: string; stdout?: string; code?: number },
): void {
  execFileAsyncMock.mockRejectedValueOnce(
    Object.assign(new Error(options?.message ?? "docker failed"), {
      code: options?.code ?? 1,
      stdout: options?.stdout ?? "",
      stderr,
    }),
  );
}

function resolveExec(stdout: string, stderr = ""): void {
  execFileAsyncMock.mockResolvedValueOnce({ stdout, stderr });
}

describe("desktop environment docker cli", () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset();
    execFileMock.mockReset();
  });

  it("skips pulling when the cached image already matches the requested platform", async () => {
    resolveExec('[{"Os":"linux","Architecture":"amd64"}]\n');

    await expect(
      ensureImageAvailable("ghcr.io/tyrumai/tyrum-desktop-sandbox:main", {
        platform: "linux/amd64",
      }),
    ).resolves.toBeUndefined();

    expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      "docker",
      ["image", "inspect", "ghcr.io/tyrumai/tyrum-desktop-sandbox:main"],
      expect.objectContaining({ encoding: "utf8", timeout: 15_000 }),
    );
  });

  it("pulls the requested platform when a different platform is cached locally", async () => {
    resolveExec('[{"Os":"linux","Architecture":"arm64"}]\n');
    resolveExec("pulled\n");

    await expect(
      ensureImageAvailable("ghcr.io/tyrumai/tyrum-desktop-sandbox:main", {
        platform: "linux/amd64",
      }),
    ).resolves.toBeUndefined();

    expect(execFileAsyncMock).toHaveBeenCalledTimes(2);
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      1,
      "docker",
      ["image", "inspect", "ghcr.io/tyrumai/tyrum-desktop-sandbox:main"],
      expect.objectContaining({ encoding: "utf8", timeout: 15_000 }),
    );
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      2,
      "docker",
      ["pull", "--platform", "linux/amd64", "ghcr.io/tyrumai/tyrum-desktop-sandbox:main"],
      expect.objectContaining({ encoding: "utf8", timeout: 600_000, maxBuffer: 33_554_432 }),
    );
  });

  it("pulls missing images with the requested platform", async () => {
    rejectExec("Error response from daemon: No such image");
    resolveExec("pulled\n");

    await expect(
      ensureImageAvailable("ghcr.io/tyrumai/tyrum-desktop-sandbox:main", {
        platform: "linux/amd64",
      }),
    ).resolves.toBeUndefined();

    expect(execFileAsyncMock).toHaveBeenCalledTimes(2);
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      2,
      "docker",
      ["pull", "--platform", "linux/amd64", "ghcr.io/tyrumai/tyrum-desktop-sandbox:main"],
      expect.objectContaining({ encoding: "utf8", timeout: 600_000, maxBuffer: 33_554_432 }),
    );
  });

  it("adds operator guidance when the official image cannot be pulled anonymously", async () => {
    rejectExec("Error response from daemon: No such image");
    rejectExec("unauthorized");

    await expect(
      ensureImageAvailable("ghcr.io/tyrumai/tyrum-desktop-sandbox:main", {
        platform: "linux/amd64",
      }),
    ).rejects.toThrow(/could not be pulled anonymously from GHCR/);
  });
});
