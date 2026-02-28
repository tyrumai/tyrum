type TakeoverNodeIdentity = {
  label?: string;
  metadata?: unknown;
};

function normalizeHttpUrl(rawUrl: string): string | undefined {
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function extractTakeoverUrlFromNodeMetadata(metadata?: unknown): string | undefined {
  const record = asRecord(metadata);
  if (!record) return undefined;

  const direct =
    typeof record["takeover_url"] === "string"
      ? record["takeover_url"]
      : typeof record["takeoverUrl"] === "string"
        ? record["takeoverUrl"]
        : undefined;
  if (typeof direct === "string") {
    const normalized = normalizeHttpUrl(direct);
    if (normalized) return normalized;
  }

  const takeover = asRecord(record["takeover"]);
  const nestedUrl = typeof takeover?.["url"] === "string" ? takeover["url"] : undefined;
  if (typeof nestedUrl === "string") {
    const normalized = normalizeHttpUrl(nestedUrl);
    if (normalized) return normalized;
  }

  return undefined;
}

export function extractTakeoverUrlFromNodeLabel(label?: string): string | undefined {
  if (!label) return undefined;
  const markerIndex = label.lastIndexOf("(takeover:");
  if (markerIndex < 0) return undefined;

  const afterMarker = label.slice(markerIndex + "(takeover:".length).trim();
  const rawUrl = afterMarker.split(")")[0]?.trim();
  if (!rawUrl) return undefined;

  return normalizeHttpUrl(rawUrl);
}

export function extractTakeoverUrlFromNodeIdentity(node: TakeoverNodeIdentity): string | undefined {
  return (
    extractTakeoverUrlFromNodeMetadata(node.metadata) ?? extractTakeoverUrlFromNodeLabel(node.label)
  );
}
