export const AUTH_COOKIE_NAME = "tyrum_admin_token";

export function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader) {
    return undefined;
  }

  const parts = authorizationHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
    return undefined;
  }

  return parts[1];
}
