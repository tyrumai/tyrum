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
    const runUtilityHostMode = vi.fn().mockResolvedValue(false);

    await bootstrap(importMain, runUtilityHostMode);

    expect(importMain).toHaveBeenCalledTimes(1);
    expect(runUtilityHostMode).toHaveBeenCalledTimes(1);
  });

  it("skips loading the main index module when utility-host mode handled the process", async () => {
    const importMain = vi.fn();
    const runUtilityHostMode = vi.fn().mockResolvedValue(true);

    await bootstrap(importMain, runUtilityHostMode);

    expect(runUtilityHostMode).toHaveBeenCalledTimes(1);
    expect(importMain).not.toHaveBeenCalled();
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
