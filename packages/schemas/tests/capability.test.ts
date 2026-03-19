import { describe, expect, it } from "vitest";
import { CapabilityKind } from "../src/index.js";
import {
  CANONICAL_CAPABILITY_IDS,
  BROWSER_AUTOMATION_CAPABILITY_IDS,
  FILESYSTEM_CAPABILITY_IDS,
  LEGACY_ID_MIGRATION_MAP,
  isLegacyCapabilityDescriptorId,
  migrateCapabilityDescriptorId,
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
    expect(CapabilityKind.parse("desktop")).toBe("desktop");
  });

  it("maps core client capability to namespaced ID", () => {
    expect(descriptorIdForClientCapability("playwright")).toBe("tyrum.playwright");
  });

  it("builds capability descriptors with default and explicit versions", () => {
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
    expect(clientCapabilityFromDescriptorId("tyrum.desktop.screenshot")).toBe("desktop");
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
    // Umbrella IDs now expand through the migration map to canonical IDs
    expect(expandCapabilityDescriptorId("tyrum.browser")).toEqual([
      "tyrum.location.get",
      "tyrum.camera.capture-photo",
      "tyrum.audio.record",
    ]);
    // Already-canonical IDs pass through unchanged
    expect(expandCapabilityDescriptorId("tyrum.desktop.screenshot")).toEqual([
      "tyrum.desktop.screenshot",
    ]);
  });

  it("normalizes umbrella descriptors into canonical, deduplicated descriptors", () => {
    expect(
      normalizeCapabilityDescriptors([
        { id: "tyrum.browser", version: "2.0.0" },
        { id: "tyrum.browser.camera.capture-photo", version: "3.0.0" },
      ]),
    ).toEqual([
      { id: "tyrum.location.get", version: "2.0.0" },
      // The explicit entry wins with version 3.0.0 because it comes last
      { id: "tyrum.camera.capture-photo", version: "3.0.0" },
      { id: "tyrum.audio.record", version: "2.0.0" },
    ]);
  });

  it("normalizes platform-specific IDs to canonical IDs", () => {
    expect(
      normalizeCapabilityDescriptors([
        { id: "tyrum.ios.camera.capture-photo", version: "1.0.0" },
        { id: "tyrum.android.location.get-current", version: "1.0.0" },
      ]),
    ).toEqual([
      { id: "tyrum.camera.capture-photo", version: "1.0.0" },
      { id: "tyrum.location.get", version: "1.0.0" },
    ]);
  });

  it("returns undefined for unknown namespaced descriptor IDs", () => {
    expect(clientCapabilityFromDescriptorId("camera.capture")).toBeUndefined();
  });
});

describe("canonical capability IDs", () => {
  it("contains all expected capability types", () => {
    const types = new Set(CANONICAL_CAPABILITY_IDS.map((id) => id.split(".")[1]));
    expect(types).toContain("camera");
    expect(types).toContain("audio");
    expect(types).toContain("location");
    expect(types).toContain("desktop");
    expect(types).toContain("browser");
    expect(types).toContain("fs");
  });

  it("browser automation IDs are a subset of canonical IDs", () => {
    for (const id of BROWSER_AUTOMATION_CAPABILITY_IDS) {
      expect(CANONICAL_CAPABILITY_IDS).toContain(id);
      expect(id).toMatch(/^tyrum\.browser\./);
    }
  });

  it("has 22 browser automation capabilities", () => {
    expect(BROWSER_AUTOMATION_CAPABILITY_IDS).toHaveLength(22);
  });

  it("exports frozen derived capability arrays", () => {
    expect(Object.isFrozen(BROWSER_AUTOMATION_CAPABILITY_IDS)).toBe(true);
    expect(Object.isFrozen(FILESYSTEM_CAPABILITY_IDS)).toBe(true);
  });
});

describe("legacy ID migration", () => {
  it("detects legacy platform-namespaced IDs", () => {
    expect(isLegacyCapabilityDescriptorId("tyrum.ios.camera.capture-photo")).toBe(true);
    expect(isLegacyCapabilityDescriptorId("tyrum.android.location.get-current")).toBe(true);
    expect(isLegacyCapabilityDescriptorId("tyrum.browser.geolocation.get")).toBe(true);
    expect(isLegacyCapabilityDescriptorId("tyrum.playwright")).toBe(true);
    expect(isLegacyCapabilityDescriptorId("tyrum.cli")).toBe(false);
    expect(isLegacyCapabilityDescriptorId("tyrum.http")).toBe(false);
  });

  it("does not flag canonical IDs as legacy", () => {
    expect(isLegacyCapabilityDescriptorId("tyrum.camera.capture-photo")).toBe(false);
    expect(isLegacyCapabilityDescriptorId("tyrum.desktop.screenshot")).toBe(false);
    expect(isLegacyCapabilityDescriptorId("tyrum.browser.navigate")).toBe(false);
    expect(isLegacyCapabilityDescriptorId("tyrum.cli.execute")).toBe(false);
    expect(isLegacyCapabilityDescriptorId("tyrum.http.request")).toBe(false);
  });

  it("migrates platform-specific sensor IDs to canonical cross-platform IDs", () => {
    expect(migrateCapabilityDescriptorId("tyrum.ios.camera.capture-photo")).toEqual([
      "tyrum.camera.capture-photo",
    ]);
    expect(migrateCapabilityDescriptorId("tyrum.android.location.get-current")).toEqual([
      "tyrum.location.get",
    ]);
    expect(migrateCapabilityDescriptorId("tyrum.browser.microphone.record")).toEqual([
      "tyrum.audio.record",
    ]);
  });

  it("expands monolithic playwright ID to all browser automation IDs", () => {
    const migrated = migrateCapabilityDescriptorId("tyrum.playwright");
    expect(migrated).toEqual(BROWSER_AUTOMATION_CAPABILITY_IDS);
  });

  it("passes through CLI/HTTP IDs unchanged (no longer in migration map)", () => {
    expect(migrateCapabilityDescriptorId("tyrum.cli")).toEqual(["tyrum.cli"]);
    expect(migrateCapabilityDescriptorId("tyrum.http")).toEqual(["tyrum.http"]);
  });

  it("passes through already-canonical IDs unchanged", () => {
    expect(migrateCapabilityDescriptorId("tyrum.camera.capture-photo")).toEqual([
      "tyrum.camera.capture-photo",
    ]);
    expect(migrateCapabilityDescriptorId("tyrum.desktop.screenshot")).toEqual([
      "tyrum.desktop.screenshot",
    ]);
  });

  it("all legacy migration targets are valid canonical IDs", () => {
    for (const [, target] of Object.entries(LEGACY_ID_MIGRATION_MAP)) {
      const targets = typeof target === "string" ? [target] : target;
      for (const t of targets) {
        expect(CANONICAL_CAPABILITY_IDS).toContain(t);
      }
    }
  });
});
