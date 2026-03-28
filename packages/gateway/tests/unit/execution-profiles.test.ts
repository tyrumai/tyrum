import { describe, expect, it } from "vitest";
import {
  normalizeExecutionProfileId,
  getExecutionProfile,
} from "../../src/modules/agent/execution-profiles.js";

describe("normalizeExecutionProfileId", () => {
  it("returns canonical id for known profile names", () => {
    expect(normalizeExecutionProfileId("interaction")).toBe("interaction");
    expect(normalizeExecutionProfileId("explorer_ro")).toBe("explorer_ro");
    expect(normalizeExecutionProfileId("reviewer_ro")).toBe("reviewer_ro");
    expect(normalizeExecutionProfileId("planner")).toBe("planner");
    expect(normalizeExecutionProfileId("jury")).toBe("jury");
    expect(normalizeExecutionProfileId("executor_rw")).toBe("executor_rw");
  });

  it("resolves aliases", () => {
    expect(normalizeExecutionProfileId("executor")).toBe("executor_rw");
    expect(normalizeExecutionProfileId("explorer")).toBe("explorer_ro");
    expect(normalizeExecutionProfileId("reviewer")).toBe("reviewer_ro");
    expect(normalizeExecutionProfileId("integrator")).toBe("executor_rw");
  });

  it("is case-insensitive", () => {
    expect(normalizeExecutionProfileId("INTERACTION")).toBe("interaction");
    expect(normalizeExecutionProfileId("Explorer")).toBe("explorer_ro");
  });

  it("trims whitespace", () => {
    expect(normalizeExecutionProfileId("  planner  ")).toBe("planner");
  });

  it("returns undefined for empty string", () => {
    expect(normalizeExecutionProfileId("")).toBeUndefined();
    expect(normalizeExecutionProfileId("  ")).toBeUndefined();
  });

  it("returns undefined for unknown profile names", () => {
    expect(normalizeExecutionProfileId("unknown")).toBeUndefined();
    expect(normalizeExecutionProfileId("admin")).toBeUndefined();
  });
});

describe("getExecutionProfile", () => {
  it("returns profiles for all known ids", () => {
    const ids = [
      "interaction",
      "explorer_ro",
      "reviewer_ro",
      "planner",
      "jury",
      "executor_rw",
    ] as const;
    for (const id of ids) {
      const profile = getExecutionProfile(id);
      expect(profile.id).toBe(id);
      expect(Array.isArray(profile.allowed_conversations)).toBe(true);
      expect(Array.isArray(profile.tool_allowlist)).toBe(true);
    }
  });

  it("maps integrator to executor_rw", () => {
    const profile = getExecutionProfile("integrator");
    expect(profile.id).toBe("executor_rw");
  });

  it("interaction profile has subagent and work capabilities", () => {
    const profile = getExecutionProfile("interaction");
    expect(profile.capabilities).toContain("subagent.spawn");
    expect(profile.capabilities).toContain("work.write");
  });

  it("explorer_ro profile has no capabilities", () => {
    const profile = getExecutionProfile("explorer_ro");
    expect(profile.capabilities).toEqual([]);
  });
});
