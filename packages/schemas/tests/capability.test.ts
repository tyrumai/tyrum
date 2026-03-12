import { describe, expect, it } from "vitest";
import { CapabilityKind } from "../src/index.js";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  CapabilityDescriptor,
  ClientCapability,
  capabilityDescriptorsForClientCapability,
  clientCapabilityFromDescriptorId,
  descriptorIdForClientCapability,
  descriptorIdsForClientCapability,
  expandCapabilityDescriptorId,
  isLegacyUmbrellaCapabilityDescriptorId,
  normalizeCapabilityDescriptors,
} from "../src/capability.js";
import { expectRejects } from "./test-helpers.js";

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

  it("rejects non-semver version strings", () => {
    expectRejects(CapabilityDescriptor, { id: "system.shell.exec", version: "1" });
  });

  it("rejects descriptor IDs with wrong type", () => {
    expectRejects(CapabilityDescriptor, { id: 123, version: "1.0.0" });
  });
});

describe("descriptor legacy mappings", () => {
  it("exports CapabilityKind as the legacy compatibility alias", () => {
    expect(CapabilityKind).toBe(ClientCapability);
    expect(CapabilityKind.parse("http")).toBe("http");
  });

  it("maps core client capability to namespaced ID", () => {
    expect(descriptorIdForClientCapability("cli")).toBe("tyrum.cli");
  });

  it("builds capability descriptors with default and explicit versions", () => {
    expect(capabilityDescriptorsForClientCapability("http")).toEqual([
      {
        id: "tyrum.http",
        version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
      },
    ]);
    expect(capabilityDescriptorsForClientCapability("desktop", "2.1.0")).toEqual([
      { id: "tyrum.desktop.screenshot", version: "2.1.0" },
      { id: "tyrum.desktop.snapshot", version: "2.1.0" },
      { id: "tyrum.desktop.query", version: "2.1.0" },
      { id: "tyrum.desktop.act", version: "2.1.0" },
      { id: "tyrum.desktop.mouse", version: "2.1.0" },
      { id: "tyrum.desktop.keyboard", version: "2.1.0" },
      { id: "tyrum.desktop.wait-for", version: "2.1.0" },
    ]);
  });

  it("rejects singular descriptor lookup for umbrella capabilities", () => {
    expect(() => descriptorIdForClientCapability("browser")).toThrow(/multiple descriptor IDs/);
  });

  it("expands browser capability to exact descriptor IDs", () => {
    expect(descriptorIdsForClientCapability("browser")).toEqual([
      "tyrum.browser.geolocation.get",
      "tyrum.browser.camera.capture-photo",
      "tyrum.browser.microphone.record",
    ]);
  });

  it("maps namespaced core descriptor ID back to client capability", () => {
    expect(clientCapabilityFromDescriptorId("tyrum.http")).toBe("http");
  });

  it("maps exact browser descriptor IDs back to client capability", () => {
    expect(clientCapabilityFromDescriptorId("tyrum.browser.camera.capture-photo")).toBe("browser");
  });

  it("maps namespaced browser descriptor ID back to client capability", () => {
    expect(clientCapabilityFromDescriptorId("tyrum.browser")).toBe("browser");
  });

  it("detects and expands legacy umbrella descriptor IDs", () => {
    expect(isLegacyUmbrellaCapabilityDescriptorId("tyrum.browser")).toBe(true);
    expect(isLegacyUmbrellaCapabilityDescriptorId("tyrum.browser.geolocation.get")).toBe(false);
    expect(expandCapabilityDescriptorId("tyrum.browser")).toEqual([
      "tyrum.browser.geolocation.get",
      "tyrum.browser.camera.capture-photo",
      "tyrum.browser.microphone.record",
    ]);
    expect(expandCapabilityDescriptorId("tyrum.http")).toEqual(["tyrum.http"]);
  });

  it("normalizes umbrella descriptors into exact, deduplicated descriptors", () => {
    expect(
      normalizeCapabilityDescriptors([
        { id: "tyrum.browser", version: "2.0.0" },
        { id: "tyrum.browser.camera.capture-photo", version: "3.0.0" },
      ]),
    ).toEqual([
      { id: "tyrum.browser.geolocation.get", version: "2.0.0" },
      { id: "tyrum.browser.camera.capture-photo", version: "3.0.0" },
      { id: "tyrum.browser.microphone.record", version: "2.0.0" },
    ]);
  });

  it("returns undefined for unknown namespaced descriptor IDs", () => {
    expect(clientCapabilityFromDescriptorId("camera.capture")).toBeUndefined();
  });
});
