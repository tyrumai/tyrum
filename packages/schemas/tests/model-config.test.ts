import { describe, expect, it } from "vitest";
import { ConfiguredExecutionProfileId } from "../src/model-config.js";

describe("ConfiguredExecutionProfileId", () => {
  it("does not expose integrator as a public configurable profile", () => {
    expect(ConfiguredExecutionProfileId.options).not.toContain("integrator");
    expect(ConfiguredExecutionProfileId.options).toContain("executor_rw");
  });
});
