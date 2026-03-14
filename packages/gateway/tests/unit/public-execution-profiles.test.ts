import { describe, expect, it } from "vitest";
import {
  normalizePublicExecutionProfileId,
  PUBLIC_EXECUTION_PROFILE_IDS,
} from "../../src/modules/models/public-execution-profiles.js";

describe("public execution profiles", () => {
  it("aliases legacy integrator to executor_rw and exposes only public profiles", () => {
    expect(normalizePublicExecutionProfileId("integrator")).toBe("executor_rw");
    expect(PUBLIC_EXECUTION_PROFILE_IDS).toContain("executor_rw");
    expect(PUBLIC_EXECUTION_PROFILE_IDS).not.toContain("integrator");
  });
});
