export const AUTH_QUERY_PARAM = "token";

function safeParseUrl(raw: string): URL | null {
  try {
    return new URL(raw, "http://tyrum.local");
  } catch {
    return null;
  }
}

export function readAuthTokenFromUrl(url: string): string | undefined {
  const parsed = safeParseUrl(url);
  const token = parsed?.searchParams.get(AUTH_QUERY_PARAM)?.trim();
  return token ? token : undefined;
}

export function stripAuthTokenFromUrl(url: string): string {
  const parsed = safeParseUrl(url);
  if (!parsed) return url;

  if (parsed.searchParams.has(AUTH_QUERY_PARAM)) {
    parsed.searchParams.delete(AUTH_QUERY_PARAM);
  }

  const query = parsed.searchParams.toString();
  return `${parsed.pathname}${query ? `?${query}` : ""}${parsed.hash}`;
}
