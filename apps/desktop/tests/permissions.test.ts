import { describe, expect, it } from "vitest";
import {
  resolvePermissions,
  type ResolvedPermissions,
} from "../src/main/config/permissions.js";
import type { PermissionProfile } from "../src/main/config/schema.js";

describe("resolvePermissions", () => {
  it("safe profile: screenshot allowed, input/playwright/cli/http disabled", () => {
    const p = resolvePermissions("safe", {});
    expect(p.desktopScreenshot).toBe(true);
    expect(p.desktopInput).toBe(false);
    expect(p.desktopInputRequiresConfirmation).toBe(true);
    expect(p.playwright).toBe(false);
    expect(p.playwrightDomainRestricted).toBe(true);
    expect(p.cli).toBe(false);
    expect(p.cliAllowlistEnforced).toBe(true);
    expect(p.http).toBe(false);
    expect(p.httpAllowlistEnforced).toBe(true);
  });

  it("balanced profile: everything enabled with confirmations and allowlists enforced", () => {
    const p = resolvePermissions("balanced", {});
    expect(p.desktopScreenshot).toBe(true);
    expect(p.desktopInput).toBe(true);
    expect(p.desktopInputRequiresConfirmation).toBe(true);
    expect(p.playwright).toBe(true);
    expect(p.playwrightDomainRestricted).toBe(true);
    expect(p.cli).toBe(true);
    expect(p.cliAllowlistEnforced).toBe(true);
    expect(p.http).toBe(true);
    expect(p.httpAllowlistEnforced).toBe(true);
  });

  it("poweruser profile: everything enabled, no confirmations, no allowlist restrictions", () => {
    const p = resolvePermissions("poweruser", {});
    expect(p.desktopScreenshot).toBe(true);
    expect(p.desktopInput).toBe(true);
    expect(p.desktopInputRequiresConfirmation).toBe(false);
    expect(p.playwright).toBe(true);
    expect(p.playwrightDomainRestricted).toBe(false);
    expect(p.cli).toBe(true);
    expect(p.cliAllowlistEnforced).toBe(false);
    expect(p.http).toBe(true);
    expect(p.httpAllowlistEnforced).toBe(false);
  });

  it("overrides are applied on top of profile defaults", () => {
    const p = resolvePermissions("balanced", { desktopInput: false });
    expect(p.desktopInput).toBe(false);
    // Other fields remain at balanced defaults
    expect(p.desktopScreenshot).toBe(true);
    expect(p.playwright).toBe(true);
  });

  it("unknown override keys are silently ignored", () => {
    const p = resolvePermissions("balanced", { unknownKey: true });
    // Must not crash and result matches balanced defaults
    expect(p).toEqual(resolvePermissions("balanced", {}));
  });

  it("override can enable a capability disabled by safe profile", () => {
    const p = resolvePermissions("safe", { playwright: true });
    expect(p.playwright).toBe(true);
    // Other safe defaults remain unchanged
    expect(p.desktopInput).toBe(false);
    expect(p.cli).toBe(false);
    expect(p.http).toBe(false);
  });

  it("all profiles have desktopScreenshot enabled", () => {
    const profiles: PermissionProfile[] = ["safe", "balanced", "poweruser"];
    for (const profile of profiles) {
      const p = resolvePermissions(profile, {});
      expect(p.desktopScreenshot).toBe(true);
    }
  });
});
