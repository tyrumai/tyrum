export function normalizeHttpUrl(rawUrl: string, baseUrl?: string): string | undefined {
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;

  try {
    const url = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
