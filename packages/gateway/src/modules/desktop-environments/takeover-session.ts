export const DESKTOP_TAKEOVER_PROXY_PREFIX = "/desktop-takeover/s";
export const DESKTOP_TAKEOVER_ENTRY_FILENAME = "vnc.html";
export const DESKTOP_TAKEOVER_SESSION_TTL_MS = 30 * 60 * 1000;

export function buildDesktopTakeoverEntryPath(token: string): string {
  return `${DESKTOP_TAKEOVER_PROXY_PREFIX}/${encodeURIComponent(token)}/${DESKTOP_TAKEOVER_ENTRY_FILENAME}`;
}

export function buildDesktopTakeoverEntryUrl(publicBaseUrl: string, token: string): string {
  return new URL(
    `${buildDesktopTakeoverEntryPath(token)}?autoconnect=true`,
    publicBaseUrl,
  ).toString();
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
