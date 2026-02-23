/**
 * WebSocket handshake authentication.
 *
 * Requires a valid gateway token from the token store.
 */

import type { TokenStore } from "../modules/auth/token-store.js";
import type { AuthTokenClaims } from "../modules/auth/token-store.js";

/**
 * Authenticates the token supplied during the WebSocket upgrade handshake.
 *
 * @param token - Auth token from the handshake metadata.
 * @param tokenStore - Token store to validate against.
 * @returns Auth token claims when the supplied token is valid.
 */
export function authenticateWsToken(
  token: string | undefined,
  tokenStore?: TokenStore,
): AuthTokenClaims | null {
  if (!tokenStore) return null;
  if (!token) return null;
  return tokenStore.authenticate(token);
}
