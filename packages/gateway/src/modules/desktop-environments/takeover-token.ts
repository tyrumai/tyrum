export const DESKTOP_TAKEOVER_PROXY_PREFIX = "/desktop-takeover/s";
export const DESKTOP_TAKEOVER_ENTRY_FILENAME = "vnc.html";
export const DESKTOP_TAKEOVER_CONVERSATION_TTL_MS = 30 * 60 * 1000;
const DESKTOP_TAKEOVER_AUTOCONNECT_PARAM = "autoconnect";
const DESKTOP_TAKEOVER_AUTOCONNECT_VALUE = "true";

export function buildDesktopTakeoverEntryPath(token: string): string {
  return `${DESKTOP_TAKEOVER_PROXY_PREFIX}/${encodeURIComponent(token)}/${DESKTOP_TAKEOVER_ENTRY_FILENAME}`;
}

export function ensureDesktopTakeoverEntrySearch(search: string): string {
  const params = new URLSearchParams(search);
  if (!params.has(DESKTOP_TAKEOVER_AUTOCONNECT_PARAM)) {
    params.set(DESKTOP_TAKEOVER_AUTOCONNECT_PARAM, DESKTOP_TAKEOVER_AUTOCONNECT_VALUE);
  }
  const serialized = params.toString();
  return serialized.length > 0 ? `?${serialized}` : "";
}

export function buildDesktopTakeoverEntryUrl(publicBaseUrl: string, token: string): string {
  const entryUrl = new URL(buildDesktopTakeoverEntryPath(token), publicBaseUrl);
  entryUrl.search = ensureDesktopTakeoverEntrySearch("");
  return entryUrl.toString();
}

export function matchesDesktopTakeoverProxyPath(pathname: string): boolean {
  return (
    pathname === DESKTOP_TAKEOVER_PROXY_PREFIX ||
    pathname.startsWith(`${DESKTOP_TAKEOVER_PROXY_PREFIX}/`)
  );
}

export function parseDesktopTakeoverProxyPath(pathname: string): {
  token: string;
  upstreamPath: string;
} | null {
  if (!matchesDesktopTakeoverProxyPath(pathname)) {
    return null;
  }

  const suffix = pathname.slice(`${DESKTOP_TAKEOVER_PROXY_PREFIX}/`.length);
  const slashIndex = suffix.indexOf("/");
  if (slashIndex <= 0) {
    return null;
  }

  const token = suffix.slice(0, slashIndex).trim();
  const upstreamPath = suffix.slice(slashIndex + 1).trim();
  if (!token || !upstreamPath) {
    return null;
  }

  return { token, upstreamPath };
}
