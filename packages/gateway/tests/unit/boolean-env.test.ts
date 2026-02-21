import { afterEach, describe, expect, it, vi } from "vitest";
import { readBooleanEnv } from "../../src/env/boolean-env.js";

describe("readBooleanEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns default value when env var is unset", () => {
    vi.stubEnv("SAMPLE_FLAG", undefined);
    expect(readBooleanEnv("SAMPLE_FLAG", false)).toBe(false);
    expect(readBooleanEnv("SAMPLE_FLAG", true)).toBe(true);
  });

  it("returns default value when env var is empty/whitespace", () => {
    vi.stubEnv("SAMPLE_FLAG", "");
    expect(readBooleanEnv("SAMPLE_FLAG", false)).toBe(false);
    expect(readBooleanEnv("SAMPLE_FLAG", true)).toBe(true);

    vi.stubEnv("SAMPLE_FLAG", "   ");
    expect(readBooleanEnv("SAMPLE_FLAG", false)).toBe(false);
    expect(readBooleanEnv("SAMPLE_FLAG", true)).toBe(true);
  });

  it("treats common truthy values as enabled", () => {
    const enabled = ["1", "true", "on", "yes", " TRUE ", "On"];
    for (const value of enabled) {
      vi.stubEnv("SAMPLE_FLAG", value);
      expect(readBooleanEnv("SAMPLE_FLAG", false)).toBe(true);
      expect(readBooleanEnv("SAMPLE_FLAG", true)).toBe(true);
    }
  });

  it("treats common falsy values as disabled", () => {
    const disabled = ["0", "false", "off", "no", " FALSE ", "Off"];
    for (const value of disabled) {
      vi.stubEnv("SAMPLE_FLAG", value);
      expect(readBooleanEnv("SAMPLE_FLAG", false)).toBe(false);
      expect(readBooleanEnv("SAMPLE_FLAG", true)).toBe(false);
    }
  });

  it("treats unknown values as the default", () => {
    vi.stubEnv("SAMPLE_FLAG", "maybe");
    expect(readBooleanEnv("SAMPLE_FLAG", false)).toBe(false);
    expect(readBooleanEnv("SAMPLE_FLAG", true)).toBe(true);
  });
});

