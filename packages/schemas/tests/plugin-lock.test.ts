import { describe, expect, it } from "vitest";
import * as schemas from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("PluginLockFile", () => {
  const PluginLockFile = (schemas as unknown as Record<string, unknown>)["PluginLockFile"] as
    | { parse: (input: unknown) => unknown; safeParse: (input: unknown) => { success: boolean } }
    | undefined;

  const baseLock = {
    format: "tyrum.plugin.lock.v1",
    recorded_at: "2026-02-23T00:00:00Z",
    source: { kind: "local_path", path: "/tmp/plugin" },
    pinned_version: "0.0.1",
    integrity_sha256: "a".repeat(64),
  } as const;

  it("parses a v1 plugin.lock.json record", () => {
    expect(PluginLockFile).toBeTruthy();

    const parsed = PluginLockFile!.parse(baseLock) as Record<string, unknown>;

    expect(parsed["format"]).toBe("tyrum.plugin.lock.v1");
  });

  it("rejects a lock file with unknown format", () => {
    expect(PluginLockFile).toBeTruthy();
    expectRejects(PluginLockFile!, { ...baseLock, format: "tyrum.plugin.lock.v0" });
  });

  it("rejects a lock file with wrong integrity_sha256 type", () => {
    expect(PluginLockFile).toBeTruthy();
    expectRejects(PluginLockFile!, { ...baseLock, integrity_sha256: 123 });
  });
});
