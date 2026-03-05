import { describe, expect, it, vi } from "vitest";

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return {
    ...original,
    homedir: () => {
      throw new Error("homedir unavailable");
    },
  };
});

describe("@tyrum/cli runCli in minimal environments", () => {
  it("prints help without requiring a home directory", async () => {
    const prevTyrumHome = process.env["TYRUM_HOME"];
    const prevHome = process.env["HOME"];

    delete process.env["TYRUM_HOME"];
    delete process.env["HOME"];

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const { runCli } = await import("../../src/index.js");

      await expect(runCli(["--help"])).resolves.toBe(0);
      expect(logSpy).toHaveBeenCalled();
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();

      if (prevTyrumHome === undefined) delete process.env["TYRUM_HOME"];
      else process.env["TYRUM_HOME"] = prevTyrumHome;

      if (prevHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = prevHome;
    }
  });

  it("prints version without requiring a home directory", async () => {
    const prevTyrumHome = process.env["TYRUM_HOME"];
    const prevHome = process.env["HOME"];

    delete process.env["TYRUM_HOME"];
    delete process.env["HOME"];

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const { runCli } = await import("../../src/index.js");

      await expect(runCli(["--version"])).resolves.toBe(0);
      expect(logSpy).toHaveBeenCalled();
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();

      if (prevTyrumHome === undefined) delete process.env["TYRUM_HOME"];
      else process.env["TYRUM_HOME"] = prevTyrumHome;

      if (prevHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = prevHome;
    }
  });
});
