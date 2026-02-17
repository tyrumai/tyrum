/**
 * WebSocket handshake authentication for single-user local deployments.
 *
 * When `GATEWAY_WS_TOKEN` is set, only connections presenting a matching
 * token are accepted.  When the env var is absent (dev/local mode) all
 * connections are allowed, preserving backward compatibility.
 */

import { timingSafeEqual } from "node:crypto";

/**
 * Validates the token supplied during the WebSocket upgrade handshake.
 *
 * @returns `true` when the token matches `GATEWAY_WS_TOKEN`, or when
 *          the env var is not configured (dev/local mode).
 */
export function validateWsToken(token: string | undefined): boolean {
  const expected = process.env["GATEWAY_WS_TOKEN"];
  if (!expected) {
    // No token configured — dev/local mode, allow all
    return true;
  }
  if (!token || token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
