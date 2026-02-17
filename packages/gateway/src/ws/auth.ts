/**
 * WebSocket handshake authentication for single-user local deployments.
 *
 * In self-hosted mode no application auth is required.
 */

/**
 * Validates the token supplied during the WebSocket upgrade handshake.
 *
 * @returns `true` for all inputs.
 */
export function validateWsToken(_token: string | undefined): boolean {
  return true;
}
