import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  canRunDesktopSandboxE2e,
  readPositiveIntegerEnv,
} from "../integration/desktop-sandbox-e2e-support.js";

function readSupportFile(): string {
  const supportUrl = new URL("../integration/desktop-sandbox-e2e-support.ts", import.meta.url);
  return readFileSync(fileURLToPath(supportUrl), "utf8");
}

describe("desktop sandbox e2e support image build", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("loads rebuilt images into the local daemon", () => {
    const supportFile = readSupportFile();
    expect(supportFile).toContain(
      '["build", "--load", "-f", "docker/desktop-sandbox/Dockerfile", "-t", imageTag, "."]',
    );
  });

  test("allows CI to raise expensive docker e2e timeouts explicitly", () => {
    vi.stubEnv("TYRUM_TEST_TIMEOUT_MS", "1800000");
    expect(readPositiveIntegerEnv("TYRUM_TEST_TIMEOUT_MS", 60_000)).toBe(1_800_000);
  });

  test("falls back when timeout env values are missing or invalid", () => {
    expect(readPositiveIntegerEnv("TYRUM_TEST_TIMEOUT_MS", 60_000)).toBe(60_000);

    vi.stubEnv("TYRUM_TEST_TIMEOUT_MS", "0");
    expect(readPositiveIntegerEnv("TYRUM_TEST_TIMEOUT_MS", 60_000)).toBe(60_000);

    vi.stubEnv("TYRUM_TEST_TIMEOUT_MS", "not-a-number");
    expect(readPositiveIntegerEnv("TYRUM_TEST_TIMEOUT_MS", 60_000)).toBe(60_000);
  });

  test("requires explicit opt-in before running desktop sandbox e2e in CI", () => {
    let dockerWasChecked = false;
    const dockerAvailable = () => {
      dockerWasChecked = true;
      return true;
    };

    expect(
      canRunDesktopSandboxE2e({
        platform: "linux",
        isCi: true,
        isExplicitlyEnabled: false,
        dockerAvailable,
      }),
    ).toBe(false);
    expect(dockerWasChecked).toBe(false);

    expect(
      canRunDesktopSandboxE2e({
        platform: "linux",
        isCi: true,
        isExplicitlyEnabled: true,
        dockerAvailable,
      }),
    ).toBe(true);
    expect(dockerWasChecked).toBe(true);
  });

  test("continues to allow local linux runs when docker is available", () => {
    expect(
      canRunDesktopSandboxE2e({
        platform: "linux",
        isCi: false,
        isExplicitlyEnabled: false,
        dockerAvailable: () => true,
      }),
    ).toBe(true);
  });
});
