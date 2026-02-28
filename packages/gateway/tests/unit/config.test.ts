import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  it("parses defaults for a minimal valid env", () => {
    const config = loadConfig({ GATEWAY_TOKEN: "test-token" });

    expect(config.auth.token).toBe("test-token");
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.server.port).toBe(8788);
    expect(config.database.path).toBe("gateway.db");
  });

  it("throws with a clear error when required fields are missing", () => {
    expect(() => loadConfig({})).toThrow(/GATEWAY_TOKEN/i);
  });

  it("rejects invalid port values", () => {
    expect(() =>
      loadConfig({
        GATEWAY_TOKEN: "test-token",
        GATEWAY_PORT: "99999",
      }),
    ).toThrow(/GATEWAY_PORT/i);
  });

  it("coerces boolean env flags", () => {
    expect(
      loadConfig({
        GATEWAY_TOKEN: "test-token",
        TYRUM_ENGINE_API_ENABLED: "1",
      }).execution.engineApiEnabled,
    ).toBe(true);

    expect(
      loadConfig({
        GATEWAY_TOKEN: "test-token",
        TYRUM_ENGINE_API_ENABLED: "0",
      }).execution.engineApiEnabled,
    ).toBe(false);
  });
});
