import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { VERSION, runCli } from "../src/index.js";

describe("tui runCli", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  afterAll(() => {
    log.mockRestore();
    error.mockRestore();
  });

  afterEach(() => {
    log.mockClear();
    error.mockClear();
  });

  it("prints help", async () => {
    await expect(runCli(["--help"])).resolves.toBe(0);
    const output = log.mock.calls.flat().join("\n");
    expect(output).toMatch(/tyrum-tui/i);
    expect(output).toMatch(/--tyrum-home/i);
    expect(output).toMatch(/--reconnect/i);
  });

  it("prints version", async () => {
    await expect(runCli(["--version"])).resolves.toBe(0);
    expect(log.mock.calls.flat().join("\n")).toContain(VERSION);
  });
});
