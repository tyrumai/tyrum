/**
 * WebSocket handshake authentication.
 *
 * Precedence:
 * 1) If `GATEWAY_WS_TOKEN` is set (non-empty), require an exact match.
 *    This supports embedded/desktop deployments that generate their own token.
 * 2) Otherwise, fall back to the gateway token store when running exposed
 *    (non-local interfaces). Local-only mode remains open by default.
 */

import { timingSafeEqual } from "node:crypto";
import type { TokenStore } from "../modules/auth/token-store.js";

/**
 * Validates the token supplied during the WebSocket upgrade handshake.
 *
 * @param token - The token from the query string (?token=...)
 * @param tokenStore - Token store to validate against when exposed
 * @param isLocalOnly - When true, auth is not required unless `GATEWAY_WS_TOKEN` is set
 * @returns `true` if the token is valid or auth is not required.
 */
export function validateWsToken(
  token: string | undefined,
  tokenStore?: TokenStore,
  isLocalOnly: boolean = true,
): boolean {
  const expected = process.env["GATEWAY_WS_TOKEN"];
  if (expected && expected.length > 0) {
    if (!token || token.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  }

  if (isLocalOnly) return true;

  if (!tokenStore) return false;
  if (!token) return false;
  return tokenStore.validate(token);
}

