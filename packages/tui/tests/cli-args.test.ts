import { describe, expect, it } from "vitest";
import { parseTuiCliArgs } from "../src/cli-args.js";

describe("tui cli args", () => {
  it("parses --help", () => {
    expect(parseTuiCliArgs(["--help"])).toEqual({ kind: "help" });
  });

  it("parses --version", () => {
    expect(parseTuiCliArgs(["--version"])).toEqual({ kind: "version" });
  });

  it("parses --gateway/--token", () => {
    expect(parseTuiCliArgs(["--gateway", "http://127.0.0.1:8788", "--token", "t"])).toMatchObject({
      kind: "start",
      gatewayUrl: "http://127.0.0.1:8788",
      token: "t",
    });
  });

  it("rejects missing --gateway value", () => {
    expect(() => parseTuiCliArgs(["--gateway"])).toThrow(/--gateway requires a value/i);
  });
});
