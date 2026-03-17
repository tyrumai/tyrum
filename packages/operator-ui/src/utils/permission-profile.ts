export type Profile = "safe" | "balanced" | "poweruser";

export interface CapFlags {
  desktop: boolean;
  playwright: boolean;
  cli: boolean;
  http: boolean;
}

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
