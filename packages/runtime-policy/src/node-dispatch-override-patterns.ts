const LEGACY_UMBRELLA_IDS = [
  "tyrum.desktop",
  "tyrum.browser",
  "tyrum.ios",
  "tyrum.android",
] as const;

const LEGACY_UMBRELLA_PATTERN = /capability:(tyrum\.(?:desktop|browser|ios|android))(?=;|$)/;

export function hasLegacyUmbrellaNodeDispatchPattern(pattern: string): boolean {
  return LEGACY_UMBRELLA_PATTERN.test(pattern);
}

export function expandLegacyNodeDispatchOverridePatterns(pattern: string): string[] {
  const expanded = new Set<string>([pattern]);
  const match = pattern.match(LEGACY_UMBRELLA_PATTERN);
  if (!match) return [...expanded];

  const legacyId = match[1];
  if (!legacyId || !(LEGACY_UMBRELLA_IDS as readonly string[]).includes(legacyId)) {
    return [...expanded];
  }

  expanded.add(pattern.replace(LEGACY_UMBRELLA_PATTERN, `capability:${legacyId}.*`));
  return [...expanded];
}
