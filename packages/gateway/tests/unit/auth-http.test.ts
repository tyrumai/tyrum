/**
 * auth/http.ts — unit tests for bearer token extraction.
 */

import { describe, expect, it } from "vitest";
import { extractBearerToken, AUTH_COOKIE_NAME } from "../../src/modules/auth/http.js";

describe("extractBearerToken", () => {
  it("extracts token from a valid Bearer header", () => {
    expect(extractBearerToken("Bearer my-token-123")).toBe("my-token-123");
  });

  it("returns undefined for undefined input", () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(extractBearerToken("")).toBeUndefined();
  });

  it("returns undefined for header without Bearer prefix", () => {
    expect(extractBearerToken("Basic abc123")).toBeUndefined();
  });

  it("returns undefined for header with only Bearer and no token", () => {
    expect(extractBearerToken("Bearer")).toBeUndefined();
  });

  it("returns undefined for header with too many parts", () => {
    expect(extractBearerToken("Bearer token extra")).toBeUndefined();
  });

  it("returns undefined for lowercase bearer", () => {
    expect(extractBearerToken("bearer token")).toBeUndefined();
  });

  it("returns undefined for Bearer with empty token part", () => {
    // "Bearer " splits into ["Bearer", ""] — parts[1] is empty string (falsy)
    expect(extractBearerToken("Bearer ")).toBeUndefined();
  });
});

describe("AUTH_COOKIE_NAME", () => {
  it("is a non-empty string", () => {
    expect(typeof AUTH_COOKIE_NAME).toBe("string");
    expect(AUTH_COOKIE_NAME.length).toBeGreaterThan(0);
  });
});
