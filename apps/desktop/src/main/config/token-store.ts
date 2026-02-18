import { randomBytes } from "node:crypto";

// Lazy-loaded Electron safeStorage — not available in test environments.
let safeStorage: {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
} | null = null;

try {
  const electron = await import("electron");
  safeStorage = electron.safeStorage;
} catch {
  // Not running in Electron (e.g., tests)
}

function insecureFallbackAllowed(): boolean {
  if (process.env["TYRUM_ALLOW_INSECURE_TOKEN_STORAGE"] === "1") {
    return true;
  }
  return process.env["NODE_ENV"] === "test";
}

/**
 * Encrypt a token for storage. Returns a base64-encoded encrypted blob.
 * Falls back to base64 encoding if Electron safeStorage is not available.
 */
export function encryptToken(token: string): string {
  if (safeStorage?.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(token);
    return encrypted.toString("base64");
  }
  if (!insecureFallbackAllowed()) {
    throw new Error(
      "Secure token storage unavailable: Electron safeStorage is required unless TYRUM_ALLOW_INSECURE_TOKEN_STORAGE=1.",
    );
  }
  // Explicitly limited fallback for tests/dev opt-in only.
  return Buffer.from(token, "utf-8").toString("base64");
}

/**
 * Decrypt a stored token reference. Returns the plaintext token.
 */
export function decryptToken(tokenRef: string): string {
  if (!tokenRef) throw new Error("No token stored");
  if (safeStorage?.isEncryptionAvailable()) {
    const buffer = Buffer.from(tokenRef, "base64");
    return safeStorage.decryptString(buffer);
  }
  if (!insecureFallbackAllowed()) {
    throw new Error(
      "Secure token storage unavailable: Electron safeStorage is required unless TYRUM_ALLOW_INSECURE_TOKEN_STORAGE=1.",
    );
  }
  // Explicitly limited fallback for tests/dev opt-in only.
  return Buffer.from(tokenRef, "base64").toString("utf-8");
}

/**
 * Generate a cryptographically random token suitable for WS authentication.
 */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}
