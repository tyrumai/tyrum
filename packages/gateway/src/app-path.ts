export const APP_PATH_PREFIX = "/app";

export function matchesPathPrefixSegment(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
