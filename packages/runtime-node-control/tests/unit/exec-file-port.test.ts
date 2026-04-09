import { describe, expect, it } from "vitest";
import { runBufferedExecFile } from "../../src/exec-file-port.js";

describe("runBufferedExecFile", () => {
  it("returns stdout and stderr for successful commands", async () => {
    const result = await runBufferedExecFile(process.execPath, [
      "-e",
      'process.stdout.write("ok"); process.stderr.write("warn");',
    ]);

    expect(result).toEqual({
      status: 0,
      stdout: "ok",
      stderr: "warn",
    });
  });

  it("returns exit status and output for failed commands", async () => {
    const result = await runBufferedExecFile(process.execPath, [
      "-e",
      'process.stdout.write("partial"); process.stderr.write("bad"); process.exit(7);',
    ]);

    expect(result).toEqual({
      status: 7,
      stdout: "partial",
      stderr: "bad",
    });
  });

  it("rethrows missing binary errors", async () => {
    await expect(runBufferedExecFile("__missing_binary_for_test__", [])).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
