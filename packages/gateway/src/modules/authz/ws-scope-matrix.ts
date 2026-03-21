/**
 * WebSocket per-request scope authorization matrix.
 *
 * Mirrors the HTTP deny-by-default posture for scoped (device) tokens.
 * Admin tokens are treated as break-glass and bypass scope enforcement.
 */

import { resolveGatewayWsRequiredScopes } from "../../api/manifest.js";

export function resolveWsRequestRequiredScopes(type: string): string[] | null {
  return resolveGatewayWsRequiredScopes(type);
}
