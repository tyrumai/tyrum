import { describe, expect, it } from "vitest";
import {
  DeploymentConfig,
  DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF,
  describeDesktopEnvironmentHostAvailability,
  isDesktopEnvironmentHostAvailable,
} from "../src/index.js";

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

  it("defaults desktop environments to the published sandbox image", () => {
    const parsed = DeploymentConfig.parse({});

    expect(parsed.desktopEnvironments.defaultImageRef).toBe(DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF);
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
});
