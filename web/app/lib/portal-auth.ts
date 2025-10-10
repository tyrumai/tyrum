export const PORTAL_SESSION_COOKIE = "tyrum_portal_session";
export const PORTAL_SESSION_SECRET_ENV = "PORTAL_SESSION_SECRET";
export const PORTAL_SESSION_TOKEN_PREFIX = "portal-session-verified-";
export const PORTAL_SESSION_MAX_AGE_SECONDS = 60 * 60;
export const CTA_REDIRECT_PARAM = "redirect";
export const CTA_REDIRECT_REASON = "portal-auth";
export const CTA_FROM_PARAM = "from";

const PROTECTED_PREFIX = "/portal";
const PUBLIC_PREFIXES = ["/portal/onboarding", "/portal/auth"];
const STATIC_PORTAL_SESSION_SECRET = process.env.PORTAL_SESSION_SECRET;

let portalSessionSecretOverride: string | undefined | null = null;

export function isProtectedPortalPath(pathname: string): boolean {
  if (!pathname.startsWith(PROTECTED_PREFIX)) {
    return false;
  }

  return !PUBLIC_PREFIXES.some((publicPath) => {
    return pathname === publicPath || pathname.startsWith(`${publicPath}/`);
  });
}

function trimOrUndefined(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getPortalSessionSecret(): string | undefined {
  if (portalSessionSecretOverride !== null) {
    return trimOrUndefined(portalSessionSecretOverride ?? undefined);
  }

  const staticSecret = trimOrUndefined(STATIC_PORTAL_SESSION_SECRET);
  if (staticSecret) {
    return staticSecret;
  }

  if (typeof process !== "undefined" && process.env) {
    return trimOrUndefined(process.env.PORTAL_SESSION_SECRET);
  }

  return undefined;
}

export function requirePortalSessionSecret(): string {
  const secret = getPortalSessionSecret();

  if (!secret) {
    throw new Error(
      `${PORTAL_SESSION_SECRET_ENV} must be configured for portal verification stubs.`,
    );
  }

  return secret;
}

export function setPortalSessionSecretForTesting(secret: string | undefined) {
  portalSessionSecretOverride = secret ?? undefined;
}

export function clearPortalSessionSecretForTesting() {
  portalSessionSecretOverride = null;
}

function computeDeterministicDigest(input: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
    hash >>>= 0;
  }

  return hash.toString(36).padStart(8, "0");
}

export function computePortalSessionTokenFromSecret(secret: string): string {
  return `${PORTAL_SESSION_TOKEN_PREFIX}${computeDeterministicDigest(secret)}`;
}

export function resolvePortalSessionToken(): string {
  return computePortalSessionTokenFromSecret(requirePortalSessionSecret());
}

export function isPortalSessionTokenValid(
  token: string | undefined,
): boolean {
  if (!token) {
    return false;
  }

  const secret = getPortalSessionSecret();
  if (!secret) {
    return false;
  }

  return token === computePortalSessionTokenFromSecret(secret);
}
