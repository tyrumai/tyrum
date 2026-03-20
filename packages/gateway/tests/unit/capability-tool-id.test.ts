import { describe, expect, it } from "vitest";
import { toolIdForCapabilityDescriptor } from "../../src/modules/node/capability-tool-id.js";

describe("toolIdForCapabilityDescriptor", () => {
  it("maps canonical capability descriptor ids to dedicated tool ids", () => {
    expect(toolIdForCapabilityDescriptor("tyrum.desktop.snapshot")).toBe("tool.desktop.snapshot");
  });

  it("rejects unsupported capability descriptor prefixes", () => {
    expect(() => toolIdForCapabilityDescriptor("desktop.snapshot")).toThrow(
      "unsupported capability descriptor id: desktop.snapshot",
    );
  });
});
