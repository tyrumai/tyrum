import { describe, expect, it } from "vitest";
import { resolveTuiConfig } from "../src/config.js";

describe("resolveTuiConfig", () => {
  it("prefers explicit token over env", () => {
    const cfg = resolveTuiConfig({
      env: { GATEWAY_TOKEN: "env-token" },
      defaults: { gatewayUrl: "http://127.0.0.1:8788", tyrumHome: "/h" },
      token: "cli-token",
    });
    expect(cfg.token).toBe("cli-token");
  });

  it("falls back to env token", () => {
    const cfg = resolveTuiConfig({
      env: { GATEWAY_TOKEN: "env-token" },
      defaults: { gatewayUrl: "http://127.0.0.1:8788", tyrumHome: "/h" },
    });
    expect(cfg.token).toBe("env-token");
  });

  it("throws when no token provided", () => {
    expect(() =>
      resolveTuiConfig({
        env: {},
        defaults: { gatewayUrl: "http://127.0.0.1:8788", tyrumHome: "/h" },
      }),
    ).toThrow(/token/i);
  });

  it("derives default urls + identity path", () => {
    const cfg = resolveTuiConfig({
      env: { GATEWAY_TOKEN: "t" },
      defaults: { gatewayUrl: "http://127.0.0.1:8788", tyrumHome: "/home/test/.tyrum" },
    });
    expect(cfg.httpBaseUrl).toBe("http://127.0.0.1:8788");
    expect(cfg.wsUrl).toBe("ws://127.0.0.1:8788/ws");
    expect(cfg.deviceIdentityPath).toBe("/home/test/.tyrum/tui/device-identity.json");
    expect(cfg.reconnect).toBe(true);
  });
});

