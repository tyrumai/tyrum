import { describe, expect, it } from "vitest";
import { encryptToken, decryptToken, generateToken } from "../src/main/config/token-store.js";

describe("token-store (fallback path)", () => {
  it("encryptToken returns a non-empty base64 string", () => {
    const encrypted = encryptToken("my-secret-token");
    expect(encrypted).toBeTruthy();
    // Must be valid base64
    expect(() => Buffer.from(encrypted, "base64")).not.toThrow();
    expect(encrypted.length).toBeGreaterThan(0);
  });

  it("round-trips: decryptToken(encryptToken(token)) returns original", () => {
    const original = "ws-auth-token-abc123";
    const encrypted = encryptToken(original);
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(original);
  });

  it("decryptToken throws on empty string", () => {
    expect(() => decryptToken("")).toThrow("No token stored");
  });

  it("generateToken returns a 64-character hex string", () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generateToken returns unique values on successive calls", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });

  it("fails closed when secure storage is unavailable and fallback is not allowed", () => {
    const prevNodeEnv = process.env["NODE_ENV"];
    const prevAllowFallback = process.env["TYRUM_ALLOW_INSECURE_TOKEN_STORAGE"];
    process.env["NODE_ENV"] = "production";
    delete process.env["TYRUM_ALLOW_INSECURE_TOKEN_STORAGE"];

    try {
      expect(() => encryptToken("secret")).toThrow("Secure token storage unavailable");
      expect(() => decryptToken(Buffer.from("secret", "utf-8").toString("base64"))).toThrow(
        "Secure token storage unavailable",
      );
    } finally {
      if (prevNodeEnv === undefined) {
        delete process.env["NODE_ENV"];
      } else {
        process.env["NODE_ENV"] = prevNodeEnv;
      }

      if (prevAllowFallback === undefined) {
        delete process.env["TYRUM_ALLOW_INSECURE_TOKEN_STORAGE"];
      } else {
        process.env["TYRUM_ALLOW_INSECURE_TOKEN_STORAGE"] = prevAllowFallback;
      }
    }
  });
});
