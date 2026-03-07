import { describe, expect, it } from "vitest";
import { DeploymentConfig } from "../src/deployment-config.js";

describe("DeploymentConfig lifecycle retention", () => {
  it("defaults state.mode to local", () => {
    const parsed = DeploymentConfig.parse({});

    expect(parsed.state.mode).toBe("local");
  });

  it("accepts shared state mode", () => {
    const parsed = DeploymentConfig.parse({
      state: {
        mode: "shared",
      },
    });

    expect(parsed.state.mode).toBe("shared");
  });

  it("applies safe defaults for session and channel retention", () => {
    const parsed = DeploymentConfig.parse({});

    expect(parsed.lifecycle.sessions.ttlDays).toBe(30);
    expect(parsed.lifecycle.channels.terminalRetentionDays).toBe(7);
  });

  it("accepts explicit retention overrides", () => {
    const parsed = DeploymentConfig.parse({
      lifecycle: {
        sessions: { ttlDays: 14 },
        channels: { terminalRetentionDays: 3 },
      },
    });

    expect(parsed.lifecycle.sessions.ttlDays).toBe(14);
    expect(parsed.lifecycle.channels.terminalRetentionDays).toBe(3);
  });
});
