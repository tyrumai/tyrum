export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (fallback == null) return parsed as T;

    if (Array.isArray(fallback)) {
      return Array.isArray(parsed) ? (parsed as T) : fallback;
    }

    if (typeof fallback === "object") {
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as T)
        : fallback;
    }

    return typeof parsed === typeof fallback ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}
