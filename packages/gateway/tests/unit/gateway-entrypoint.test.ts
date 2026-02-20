import { describe, expect, it } from "vitest";

describe("gateway entrypoint (src/index.ts)", () => {
  it("can be imported without auto-starting the server", async () => {
    const originalArgv1 = process.argv[1];
    process.argv[1] = "/vitest";
    try {
      const mod = await import("../../src/index.js");

      expect(mod.VERSION).toBeTypeOf("string");
      expect(mod.createApp).toBeTypeOf("function");
      expect(mod.createContainer).toBeTypeOf("function");
      expect(mod.ConnectionManager).toBeTypeOf("function");
    } finally {
      process.argv[1] = originalArgv1;
    }
  }, 15_000);
});

