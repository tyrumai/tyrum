import { describe, expect, it } from "vitest";

import { parseDesktopNodeArgs } from "../src/cli/args.js";

describe("parseDesktopNodeArgs", () => {
  it("parses --ws-url, --token-path, and --takeover-url", () => {
    const parsed = parseDesktopNodeArgs([
      "--ws-url",
      "ws://gateway:8788/ws",
      "--token-path",
      "/gateway/.admin-token",
      "--takeover-url",
      "http://localhost:6080",
    ]);

    expect(parsed).toEqual({
      wsUrl: "ws://gateway:8788/ws",
      token: undefined,
      tokenPath: "/gateway/.admin-token",
      takeoverUrl: "http://localhost:6080",
      label: undefined,
      mode: undefined,
      home: undefined,
      help: false,
      version: false,
    });
  });

  it("supports --help and --version flags", () => {
    expect(parseDesktopNodeArgs(["--help"]).help).toBe(true);
    expect(parseDesktopNodeArgs(["--version"]).version).toBe(true);
  });

  it("parses --token, --label, --mode, and --home", () => {
    const parsed = parseDesktopNodeArgs([
      "--token",
      "test-token",
      "--label",
      "my label",
      "--mode",
      "desktop-sandbox",
      "--home",
      "/tmp/tyrum",
    ]);

    expect(parsed).toEqual({
      wsUrl: undefined,
      token: "test-token",
      tokenPath: undefined,
      takeoverUrl: undefined,
      label: "my label",
      mode: "desktop-sandbox",
      home: "/tmp/tyrum",
      help: false,
      version: false,
    });
  });

  it("throws when a flag requires a value but none provided", () => {
    expect(() => parseDesktopNodeArgs(["--token"])).toThrow("--token requires a value");
  });

  it("throws on unknown arguments", () => {
    expect(() => parseDesktopNodeArgs(["--nope"])).toThrow("unknown argument: --nope");
  });
});
