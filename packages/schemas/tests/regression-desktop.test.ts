/**
 * Schema regression tests — verify Desktop/desktop additions don't break
 * existing ActionPrimitiveKind, ClientCapability, or ActionPrimitive schemas.
 */

import { describe, it, expect } from "vitest";
import {
  ActionPrimitiveKind,
  ClientCapability,
  requiredCapability,
  requiresPostcondition,
  DesktopActionArgs,
  ActionPrimitive,
} from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("Desktop schema regression", () => {
  it("ActionPrimitiveKind includes Desktop", () => {
    expect(ActionPrimitiveKind.parse("Desktop")).toBe("Desktop");
  });

  it("ActionPrimitiveKind rejects unknown values", () => {
    expectRejects(ActionPrimitiveKind, "NotARealKind");
  });

  it("ClientCapability includes desktop", () => {
    expect(ClientCapability.parse("desktop")).toBe("desktop");
  });

  it("ClientCapability rejects unknown values", () => {
    expectRejects(ClientCapability, "camera");
  });

  it("Desktop maps to desktop capability", () => {
    expect(requiredCapability("Desktop")).toBe("desktop");
  });

  it("Desktop requires postcondition", () => {
    expect(requiresPostcondition("Desktop")).toBe(true);
  });

  it("ActionPrimitive accepts Desktop type with DesktopActionArgs", () => {
    const primitive = ActionPrimitive.parse({
      type: "Desktop",
      args: { op: "screenshot", display: "primary", format: "png" },
    });
    expect(primitive.type).toBe("Desktop");

    // Verify args can be parsed as DesktopActionArgs
    const desktopArgs = DesktopActionArgs.parse(primitive.args);
    expect(desktopArgs.op).toBe("screenshot");
  });

  it("DesktopActionArgs rejects missing op", () => {
    expectRejects(DesktopActionArgs, { display: "primary", format: "png" });
  });

  it("all 12 ActionPrimitiveKind values parse", () => {
    const kinds = [
      "Research",
      "Decide",
      "Web",
      "Android",
      "CLI",
      "Http",
      "Message",
      "Pay",
      "Store",
      "Watch",
      "Confirm",
      "Desktop",
    ];
    for (const kind of kinds) {
      expect(ActionPrimitiveKind.parse(kind)).toBe(kind);
    }
  });

  it("all 5 ClientCapability values parse", () => {
    const caps = ["playwright", "android", "cli", "http", "desktop"];
    for (const cap of caps) {
      expect(ClientCapability.parse(cap)).toBe(cap);
    }
  });

  it("ActionPrimitive with Desktop type round-trips through JSON", () => {
    const input = {
      type: "Desktop" as const,
      args: { op: "mouse", action: "click", x: 100, y: 200 },
    };
    const parsed = ActionPrimitive.parse(input);
    const json = JSON.parse(JSON.stringify(parsed));
    const restored = ActionPrimitive.parse(json);
    expect(restored.type).toBe("Desktop");
    expect(restored.args).toEqual(input.args);
  });

  it("Desktop capability mapping is consistent with requiredCapability", () => {
    // Verify that Desktop -> desktop mapping matches the pattern of other
    // capability-mapped kinds
    const mappedKinds = ["Web", "Android", "CLI", "Http", "Desktop"] as const;
    const expectedCaps = ["playwright", "android", "cli", "http", "desktop"];
    for (let i = 0; i < mappedKinds.length; i++) {
      expect(requiredCapability(mappedKinds[i]!)).toBe(expectedCaps[i]);
    }
  });

  it("non-capability kinds return undefined from requiredCapability", () => {
    const unmapped = ["Research", "Decide", "Message", "Pay", "Store", "Watch", "Confirm"] as const;
    for (const kind of unmapped) {
      expect(requiredCapability(kind)).toBeUndefined();
    }
  });
});
