/**
 * WebSocket handshake authentication.
 *
 * Validates the token supplied during the WebSocket upgrade handshake
 * against the gateway's admin token store.
 */

import type { TokenStore } from "../modules/auth/token-store.js";

/**
 * Validates the token supplied during the WebSocket upgrade handshake.
 *
 * @param token - The token from the query string (?token=...)
 * @param tokenStore - The token store to validate against
 * @param isLocalOnly - When true, all tokens are accepted (single-user local mode)
 * @returns `true` if the token is valid or auth is not required
 */
export function validateWsToken(
  token: string | undefined,
  tokenStore: TokenStore,
  isLocalOnly: boolean,
): boolean {
  // Single-user local mode — no auth required
  if (isLocalOnly) return true;

  if (!token) return false;

  return tokenStore.validate(token);
}
