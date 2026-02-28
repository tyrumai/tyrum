import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";

describe("AgentRuntime tool-set builder extraction", () => {
  it("does not keep tool-set construction methods on the runtime prototype", () => {
    const methodNames = new Set(Object.getOwnPropertyNames(AgentRuntime.prototype));
    expect(methodNames.has("buildToolSet")).toBe(false);
    expect(methodNames.has("awaitApprovalForToolExecution")).toBe(false);
    expect(methodNames.has("resolvePolicyGatedPluginToolExposure")).toBe(false);
  });
});

