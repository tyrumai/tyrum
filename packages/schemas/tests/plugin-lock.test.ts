import { describe, expect, it } from "vitest";
import * as schemas from "../src/index.js";

describe("PluginLockFile", () => {
  it("parses a v1 plugin.lock.json record", () => {
    const PluginLockFile = (schemas as unknown as Record<string, unknown>)["PluginLockFile"] as
      | { parse: (input: unknown) => unknown }
      | undefined;

    expect(PluginLockFile).toBeTruthy();

    const parsed = PluginLockFile!.parse({
      format: "tyrum.plugin.lock.v1",
      recorded_at: "2026-02-23T00:00:00Z",
      source: { kind: "local_path", path: "/tmp/plugin" },
      pinned_version: "0.0.1",
      integrity_sha256: "a".repeat(64),
    }) as Record<string, unknown>;

    expect(parsed["format"]).toBe("tyrum.plugin.lock.v1");
  });
});
