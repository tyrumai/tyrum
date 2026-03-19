export function normalizeFingerprint256(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const colonMatch = trimmed.match(/[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31}/);
  if (colonMatch) return colonMatch[0].replace(/:/g, "").toLowerCase();

  const hexMatch = trimmed.match(/[0-9A-Fa-f]{64}/);
  if (hexMatch) return hexMatch[0].toLowerCase();

  return null;
}
