import { describe, expect, it } from "vitest";
import {
  isHelperExecutionProfile,
  requireHelperExecutionProfile,
  HELPER_EXECUTION_PROFILES,
} from "../../src/modules/agent/subagent-helper-profiles.js";

describe("isHelperExecutionProfile", () => {
  it("returns true for valid helper profiles", () => {
    expect(isHelperExecutionProfile("explorer_ro")).toBe(true);
    expect(isHelperExecutionProfile("reviewer_ro")).toBe(true);
    expect(isHelperExecutionProfile("jury")).toBe(true);
  });

  it("returns false for non-helper profiles", () => {
    expect(isHelperExecutionProfile("executor_rw")).toBe(false);
    expect(isHelperExecutionProfile("planner")).toBe(false);
    expect(isHelperExecutionProfile("interaction")).toBe(false);
    expect(isHelperExecutionProfile("unknown")).toBe(false);
  });
});

describe("requireHelperExecutionProfile", () => {
  it("returns valid helper profile", () => {
    expect(requireHelperExecutionProfile("explorer_ro")).toBe("explorer_ro");
    expect(requireHelperExecutionProfile("  reviewer_ro  ")).toBe("reviewer_ro");
  });

  it("throws for undefined", () => {
    expect(() => requireHelperExecutionProfile(undefined)).toThrow("execution_profile is required");
  });

  it("throws for empty string", () => {
    expect(() => requireHelperExecutionProfile("")).toThrow("execution_profile is required");
    expect(() => requireHelperExecutionProfile("  ")).toThrow("execution_profile is required");
  });

  it("throws for invalid profile with generic message", () => {
    expect(() => requireHelperExecutionProfile("executor_rw")).toThrow(
      `execution_profile must be one of: ${HELPER_EXECUTION_PROFILES.join(", ")}`,
    );
  });

  it("includes toolId in error message when provided", () => {
    expect(() =>
      requireHelperExecutionProfile("executor_rw", { toolId: "subagent.spawn" }),
    ).toThrow("subagent.spawn execution_profile must be one of");
  });
});
