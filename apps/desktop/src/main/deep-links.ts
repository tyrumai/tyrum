const DEEP_LINK_PROTOCOL = "tyrum:";

export function isDeepLinkUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === DEEP_LINK_PROTOCOL;
  } catch {
    return false;
  }
}

export function extractDeepLinkUrlFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (isDeepLinkUrl(arg)) {
      return arg;
    }
  }
  return null;
}

