/**
 * WebSocket handshake authentication — placeholder for real auth.
 *
 * Accepts any non-empty token. Replace with JWT / API-key validation
 * once the auth service is wired up.
 */

/**
 * Validates the token supplied during the WebSocket upgrade handshake.
 *
 * @returns `true` when the token is a non-empty string.
 */
export function validateWsToken(token: string | undefined): boolean {
  return typeof token === "string" && token.length > 0;
}
