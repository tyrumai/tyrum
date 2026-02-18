/**
 * WebSocket handshake authentication.
 *
 * Precedence:
 * 1) If `GATEWAY_WS_TOKEN` is set (non-empty), require an exact match.
 *    This supports embedded/desktop deployments that generate their own token.
 * 2) Otherwise, require a valid gateway admin token from the token store.
 */

import { timingSafeEqual } from "node:crypto";
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
  const expected = process.env["GATEWAY_WS_TOKEN"];
  if (expected && expected.length > 0) {
    if (!token || token.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  }

  if (!tokenStore) return false;
  if (!token) return false;
  return tokenStore.validate(token);
}
