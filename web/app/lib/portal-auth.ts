export const PORTAL_SESSION_COOKIE = "tyrum_portal_session";
export const CTA_REDIRECT_PARAM = "redirect";
export const CTA_REDIRECT_REASON = "portal-auth";
export const CTA_FROM_PARAM = "from";

const PROTECTED_PREFIX = "/portal";
const PUBLIC_PREFIXES = ["/portal/onboarding", "/portal/auth"];

export function isProtectedPortalPath(pathname: string): boolean {
  if (!pathname.startsWith(PROTECTED_PREFIX)) {
    return false;
  }

  return !PUBLIC_PREFIXES.some((publicPath) => {
    return pathname === publicPath || pathname.startsWith(`${publicPath}/`);
  });
}
