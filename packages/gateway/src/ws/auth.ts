/**
 * WebSocket handshake authentication.
 *
 * Requires a valid gateway token from the token store.
 */

import type { TokenStore } from "../modules/auth/token-store.js";

/**
 * Validates the token supplied during the WebSocket upgrade handshake.
 *
 * @param token - Auth token from the handshake metadata.
 * @param tokenStore - Token store to validate against when no explicit WS token is configured.
 * @returns `true` if the supplied token is valid.
 */
export function validateWsToken(
  token: string | undefined,
  tokenStore?: TokenStore,
): boolean {
  if (!tokenStore) return false;
  if (!token) return false;
  return tokenStore.authenticate(token) !== null;
}
