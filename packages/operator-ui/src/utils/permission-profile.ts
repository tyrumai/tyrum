export type Profile = "safe" | "balanced" | "poweruser";

export interface CapFlags {
  desktop: boolean;
  playwright: boolean;
}

const PROFILE_CAPABILITIES: Record<Profile, CapFlags> = {
  safe: {
    desktop: true,
    playwright: false,
  },
  balanced: {
    desktop: true,
    playwright: true,
  },
  poweruser: {
    desktop: true,
    playwright: true,
  },
};

export function capabilitiesForProfile(profile: Profile): CapFlags {
  return { ...PROFILE_CAPABILITIES[profile] };
}
