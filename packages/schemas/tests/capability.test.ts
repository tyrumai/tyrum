import { describe, expect, it } from "vitest";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  CapabilityDescriptor,
  clientCapabilityFromDescriptorId,
  descriptorIdForClientCapability,
} from "../src/capability.js";

describe("CapabilityDescriptor", () => {
  it("parses namespaced descriptor IDs", () => {
    const descriptor = CapabilityDescriptor.parse({
      id: "system.shell.exec",
      version: "2.3.1",
    });
    expect(descriptor).toEqual({
      id: "system.shell.exec",
      version: "2.3.1",
    });
  });

  it("defaults version when omitted", () => {
    const descriptor = CapabilityDescriptor.parse({
      id: "tyrum.http",
    });
    expect(descriptor.version).toBe(CAPABILITY_DESCRIPTOR_DEFAULT_VERSION);
  });

  it("rejects enum-only IDs that are not namespaced", () => {
    const parsed = CapabilityDescriptor.safeParse({
      id: "http",
      version: "1.0.0",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("descriptor legacy mappings", () => {
  it("maps core client capability to namespaced ID", () => {
    expect(descriptorIdForClientCapability("cli")).toBe("tyrum.cli");
  });

  it("maps namespaced core descriptor ID back to client capability", () => {
    expect(clientCapabilityFromDescriptorId("tyrum.http")).toBe("http");
  });

  it("returns undefined for unknown namespaced descriptor IDs", () => {
    expect(clientCapabilityFromDescriptorId("camera.capture")).toBeUndefined();
  });
});
