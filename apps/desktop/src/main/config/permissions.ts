import type { PermissionProfile } from "./schema.js";

export interface ResolvedPermissions {
  desktopScreenshot: boolean;
  desktopInput: boolean;
  desktopInputRequiresConfirmation: boolean;
  playwright: boolean;
  playwrightDomainRestricted: boolean;
}

const PROFILES: Record<PermissionProfile, ResolvedPermissions> = {
  safe: {
    desktopScreenshot: true,
    desktopInput: false,
    desktopInputRequiresConfirmation: true,
    playwright: false,
    playwrightDomainRestricted: true,
  },
  balanced: {
    desktopScreenshot: true,
    desktopInput: true,
    desktopInputRequiresConfirmation: true,
    playwright: true,
    playwrightDomainRestricted: true,
  },
  poweruser: {
    desktopScreenshot: true,
    desktopInput: true,
    desktopInputRequiresConfirmation: false,
    playwright: true,
    playwrightDomainRestricted: false,
  },
};

export function resolvePermissions(
  profile: PermissionProfile,
  overrides: Record<string, boolean>,
): ResolvedPermissions {
  const base = { ...PROFILES[profile] };
  for (const [key, value] of Object.entries(overrides)) {
    if (key in base) {
      (base as Record<string, boolean>)[key] = value;
    }
  }
  return base;
}
