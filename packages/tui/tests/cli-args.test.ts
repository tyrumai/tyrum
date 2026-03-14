import { describe, expect, it } from "vitest";
import { parseTuiCliArgs } from "../src/cli-args.js";

describe("tui cli args", () => {
  it("parses --help", () => {
    expect(parseTuiCliArgs(["--help"])).toEqual({ kind: "help" });
  });

  it("parses --version", () => {
    expect(parseTuiCliArgs(["--version"])).toEqual({ kind: "version" });
  });

  it("parses bare help/version commands only in first position", () => {
    expect(parseTuiCliArgs(["help"])).toEqual({ kind: "help" });
    expect(parseTuiCliArgs(["version"])).toEqual({ kind: "version" });
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

  it("does not treat help/version option values as commands", () => {
    expect(parseTuiCliArgs(["--gateway", "help"])).toEqual({
      kind: "start",
      gatewayUrl: "help",
    });
    expect(parseTuiCliArgs(["--token", "version"])).toEqual({
      kind: "start",
      token: "version",
    });
  });

  it("parses reconnect flags", () => {
    expect(parseTuiCliArgs(["start", "--no-reconnect"])).toEqual({
      kind: "start",
      reconnect: false,
    });
    expect(parseTuiCliArgs(["start", "--reconnect"])).toEqual({ kind: "start", reconnect: true });
  });

  it("parses home aliases", () => {
    expect(parseTuiCliArgs(["start", "--home", "/tmp"])).toEqual({
      kind: "start",
      tyrumHome: "/tmp",
    });
    expect(parseTuiCliArgs(["start", "--tyrum-home", "/tmp"])).toEqual({
      kind: "start",
      tyrumHome: "/tmp",
    });
  });

  it("rejects missing --token value", () => {
    expect(() => parseTuiCliArgs(["--token"])).toThrow(/--token requires a value/i);
  });

  it("rejects unknown arguments", () => {
    expect(() => parseTuiCliArgs(["--nope"])).toThrow(/unknown argument/i);
  });

  it("rejects unknown commands with the shared wording", () => {
    expect(() => parseTuiCliArgs(["nope"])).toThrow("unknown command 'nope'");
  });
});
