import { describe, expect, it } from "vitest";
import {
  DeploymentConfig,
  DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF,
  describeDesktopEnvironmentHostAvailability,
  isDesktopEnvironmentHostAvailable,
} from "../src/index.js";

describe("DeploymentConfig lifecycle retention", () => {
  const baseConfig = {
    server: {
      publicBaseUrl: "https://gateway.example.test",
    },
  } as const;

  it("defaults state.mode to local", () => {
    const parsed = DeploymentConfig.parse(baseConfig);

    expect(parsed.state.mode).toBe("local");
  });

  it("accepts shared state mode", () => {
    const parsed = DeploymentConfig.parse({
      ...baseConfig,
      state: {
        mode: "shared",
      },
    });

    expect(parsed.state.mode).toBe("shared");
  });

  it("applies safe defaults for conversation and channel retention", () => {
    const parsed = DeploymentConfig.parse(baseConfig);

    expect(parsed.lifecycle.conversations.ttlDays).toBe(30);
    expect(parsed.lifecycle.channels.terminalRetentionDays).toBe(7);
  });

  it("accepts explicit retention overrides", () => {
    const parsed = DeploymentConfig.parse({
      ...baseConfig,
      lifecycle: {
        conversations: { ttlDays: 14 },
        channels: { terminalRetentionDays: 3 },
      },
    });

    expect(parsed.lifecycle.conversations.ttlDays).toBe(14);
    expect(parsed.lifecycle.channels.terminalRetentionDays).toBe(3);
  });

  it("defaults desktop environments to the published sandbox image", () => {
    const parsed = DeploymentConfig.parse(baseConfig);

    expect(parsed.desktopEnvironments.defaultImageRef).toBe(DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF);
  });

  it("accepts and strips the legacy execution.engineApiEnabled field", () => {
    const parsed = DeploymentConfig.parse({
      ...baseConfig,
      execution: {
        engineApiEnabled: true,
        toolrunner: {
          launcher: "local",
        },
      },
    });

    expect(parsed.execution.toolrunner.launcher).toBe("local");
    expect(parsed.execution).not.toHaveProperty("engineApiEnabled");
  });

  it("shares desktop host availability logic across packages", () => {
    expect(
      isDesktopEnvironmentHostAvailable({
        docker_available: true,
        healthy: true,
      }),
    ).toBe(true);
    expect(
      isDesktopEnvironmentHostAvailable({
        docker_available: false,
        healthy: true,
      }),
    ).toBe(false);
  });

  it("prefers the recorded host error when describing desktop availability", () => {
    expect(
      describeDesktopEnvironmentHostAvailability({
        docker_available: false,
        healthy: false,
        last_error: "Cannot connect to the Docker daemon",
      }),
    ).toBe("Cannot connect to the Docker daemon");
    expect(
      describeDesktopEnvironmentHostAvailability({
        docker_available: false,
        healthy: true,
        last_error: null,
      }),
    ).toBe("docker unavailable");
  });

  it("requires server.publicBaseUrl when server config is provided explicitly", () => {
    expect(() => DeploymentConfig.parse({ server: {} })).toThrow();
  });
});
