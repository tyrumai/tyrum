export function extractTakeoverUrlFromNodeLabel(label?: string): string | undefined {
  if (!label) return undefined;
  const markerIndex = label.lastIndexOf("(takeover:");
  if (markerIndex < 0) return undefined;

  const afterMarker = label.slice(markerIndex + "(takeover:".length).trim();
  const rawUrl = afterMarker.split(")")[0]?.trim();
  if (!rawUrl) return undefined;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
