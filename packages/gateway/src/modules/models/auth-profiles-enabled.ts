const DISABLED_VALUES = new Set(["0", "false", "off", "no"]);

export function isAuthProfilesEnabled(): boolean {
  const raw = process.env["TYRUM_AUTH_PROFILES_ENABLED"]?.trim();
  if (!raw) return false;
  return !DISABLED_VALUES.has(raw.toLowerCase());
}

