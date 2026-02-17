/**
 * Admin token management for gateway authentication.
 *
 * Token resolution order:
 * 1. TYRUM_ADMIN_TOKEN environment variable
 * 2. {tyrumHome}/.admin-token file
 * 3. Generate a new random token and persist to .admin-token
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { timingSafeEqual } from "node:crypto";

const TOKEN_FILENAME = ".admin-token";

export class TokenStore {
  private token: string | undefined;

  constructor(private readonly tyrumHome: string) {}

  /**
   * Resolve the admin token. Reads from env, then file, or generates a new one.
   * Must be called before validate() or getToken().
   */
  async initialize(): Promise<string> {
    // 1. Environment variable takes precedence
    const envToken = process.env["TYRUM_ADMIN_TOKEN"]?.trim();
    if (envToken) {
      this.token = envToken;
      return this.token;
    }

    // 2. Try reading from file
    const tokenPath = join(this.tyrumHome, TOKEN_FILENAME);
    try {
      const fileContent = await readFile(tokenPath, "utf-8");
      const trimmed = fileContent.trim();
      if (trimmed) {
        this.token = trimmed;
        return this.token;
      }
    } catch {
      // File doesn't exist or is unreadable — fall through to generation.
    }

    // 3. Generate a new token and persist it
    this.token = randomUUID();
    await mkdir(this.tyrumHome, { recursive: true });
    await writeFile(tokenPath, this.token + "\n", { mode: 0o600 });
    return this.token;
  }

  /**
   * Validate a candidate token against the stored admin token.
   * Uses timing-safe comparison to prevent timing attacks.
   */
  validate(candidate: string): boolean {
    if (!this.token) return false;

    const expected = Buffer.from(this.token, "utf-8");
    const actual = Buffer.from(candidate, "utf-8");

    if (expected.length !== actual.length) return false;

    return timingSafeEqual(expected, actual);
  }

  /** Get the current token (undefined until initialize() is called). */
  getToken(): string | undefined {
    return this.token;
  }
}
