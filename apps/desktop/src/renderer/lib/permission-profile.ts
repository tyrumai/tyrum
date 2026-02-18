export type Profile = "safe" | "balanced" | "poweruser";

export interface CapFlags {
  desktop: boolean;
  playwright: boolean;
  cli: boolean;
  http: boolean;
}

export type AllowlistState = "active" | "inactive";

const PROFILE_CAPABILITIES: Record<Profile, CapFlags> = {
  safe: {
    desktop: true,
    playwright: false,
    cli: false,
    http: false,
  },
  balanced: {
    desktop: true,
    playwright: true,
    cli: true,
    http: true,
  },
  poweruser: {
    desktop: true,
    playwright: true,
    cli: true,
    http: true,
  },
};

export function capabilitiesForProfile(profile: Profile): CapFlags {
  return { ...PROFILE_CAPABILITIES[profile] };
}

export function getAllowlistMode(
  profile: Profile,
  capabilities: CapFlags,
): { cli: AllowlistState; web: AllowlistState } {
  if (profile === "safe") {
    return { cli: "inactive", web: "inactive" };
  }
  if (profile === "poweruser") {
    return { cli: "inactive", web: "inactive" };
  }
  return {
    cli: capabilities.cli ? "active" : "inactive",
    web: capabilities.playwright ? "active" : "inactive",
  };
}
