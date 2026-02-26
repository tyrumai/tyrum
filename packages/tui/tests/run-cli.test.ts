import { afterEach, describe, expect, it, vi } from "vitest";
import { VERSION, runCli } from "../src/index.js";

describe("tui runCli", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  afterEach(() => {
    log.mockClear();
    error.mockClear();
  });

  it("prints help", async () => {
    await expect(runCli(["--help"])).resolves.toBe(0);
    expect(log.mock.calls.flat().join("\n")).toMatch(/tyrum-tui/i);
  });

  it("prints version", async () => {
    await expect(runCli(["--version"])).resolves.toBe(0);
    expect(log.mock.calls.flat().join("\n")).toContain(VERSION);
  });
});

