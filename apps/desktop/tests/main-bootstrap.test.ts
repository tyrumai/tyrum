import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrap, handleBootstrapError } from "../src/main/bootstrap.js";

describe("desktop main bootstrap", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it("loads the main index module", async () => {
    const importMain = vi.fn().mockResolvedValue({ initialized: true });

    await bootstrap(importMain);

    expect(importMain).toHaveBeenCalledTimes(1);
  });

  it("sets exitCode and logs when bootstrap import fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    const error = new Error("boom");

    handleBootstrapError(error);

    expect(errorSpy).toHaveBeenCalledWith("Failed to bootstrap desktop main process", error);
    expect(process.exitCode).toBe(1);
  });
});
