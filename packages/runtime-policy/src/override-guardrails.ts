export function isSafeSuggestedOverridePattern(pattern: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes("?")) return false;

  const starIndex = trimmed.indexOf("*");
  if (starIndex === -1) return true;
  if (trimmed.indexOf("*", starIndex + 1) !== -1) return false;
  if (starIndex !== trimmed.length - 1) return false;
  if (starIndex === 0) return false;

  const previous = trimmed[starIndex - 1];
  return previous != null && !/\s/.test(previous);
}
