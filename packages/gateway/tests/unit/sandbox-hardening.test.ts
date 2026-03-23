/**
 * hardening.ts — unit tests for sandbox hardening profile resolution.
 */

import { describe, expect, it } from "vitest";
import { resolveSandboxHardeningProfile } from "../../src/modules/sandbox/hardening.js";

describe("resolveSandboxHardeningProfile", () => {
  it("returns 'hardened' for 'hardened' input", () => {
    expect(resolveSandboxHardeningProfile("hardened")).toBe("hardened");
  });

  it("returns 'hardened' for case-insensitive input", () => {
    expect(resolveSandboxHardeningProfile("HARDENED")).toBe("hardened");
    expect(resolveSandboxHardeningProfile("Hardened")).toBe("hardened");
  });

  it("returns 'hardened' for input with whitespace", () => {
    expect(resolveSandboxHardeningProfile("  hardened  ")).toBe("hardened");
  });

  it("returns 'baseline' for undefined input", () => {
    expect(resolveSandboxHardeningProfile(undefined)).toBe("baseline");
  });

  it("returns 'baseline' for 'baseline' input", () => {
    expect(resolveSandboxHardeningProfile("baseline")).toBe("baseline");
  });

  it("returns 'baseline' for empty string", () => {
    expect(resolveSandboxHardeningProfile("")).toBe("baseline");
  });

  it("returns 'baseline' for unknown profile name", () => {
    expect(resolveSandboxHardeningProfile("unknown")).toBe("baseline");
  });
});
