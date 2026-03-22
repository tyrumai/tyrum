import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("tyrum check fetch options", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("does not perform network fetches during check", { timeout: 30_000 }, async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-check-fetch-"));

    const fetchMock = vi.fn(async () => {
      throw new Error("unexpected fetch");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const { runCli } = await import("../../src/index.js");
      const exitCode = await runCli(["check", "--home", home, "--db", ":memory:"]);
      expect(exitCode).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
