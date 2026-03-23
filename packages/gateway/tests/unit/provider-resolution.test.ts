import { describe, expect, it } from "vitest";
import { APICallError } from "ai";
import {
  parseProviderModelId,
  isAuthInvalidStatus,
  isTransientStatus,
  isCredentialPaymentOrEntitlementStatus,
  getStopFallbackApiCallError,
  resolveProviderBaseURL,
  providerRequiresConfiguredAccount,
} from "../../src/modules/agent/runtime/provider-resolution.js";

describe("parseProviderModelId", () => {
  it("parses a valid provider/model string", () => {
    expect(parseProviderModelId("openai/gpt-4")).toEqual({
      providerId: "openai",
      modelId: "gpt-4",
    });
  });

  it("handles whitespace around the input", () => {
    expect(parseProviderModelId("  anthropic/claude-3  ")).toEqual({
      providerId: "anthropic",
      modelId: "claude-3",
    });
  });

  it("throws for a model string without a slash", () => {
    expect(() => parseProviderModelId("gpt-4")).toThrow("invalid model");
  });

  it("throws for a model string with only a leading slash", () => {
    expect(() => parseProviderModelId("/model")).toThrow("invalid model");
  });

  it("throws for a model string with only a trailing slash", () => {
    expect(() => parseProviderModelId("provider/")).toThrow("invalid model");
  });

  it("handles model IDs with multiple slashes", () => {
    const result = parseProviderModelId("provider/path/to/model");
    expect(result.providerId).toBe("provider");
    expect(result.modelId).toBe("path/to/model");
  });
});

describe("isAuthInvalidStatus", () => {
  it("returns true for 401", () => {
    expect(isAuthInvalidStatus(401)).toBe(true);
  });

  it("returns true for 403", () => {
    expect(isAuthInvalidStatus(403)).toBe(true);
  });

  it("returns false for other statuses", () => {
    expect(isAuthInvalidStatus(200)).toBe(false);
    expect(isAuthInvalidStatus(500)).toBe(false);
    expect(isAuthInvalidStatus(undefined)).toBe(false);
  });
});

describe("isTransientStatus", () => {
  it("returns true for null/undefined", () => {
    expect(isTransientStatus(undefined)).toBe(true);
    expect(isTransientStatus(null as unknown as undefined)).toBe(true);
  });

  it("returns true for 429 (rate limited)", () => {
    expect(isTransientStatus(429)).toBe(true);
  });

  it("returns true for 500+ server errors", () => {
    expect(isTransientStatus(500)).toBe(true);
    expect(isTransientStatus(502)).toBe(true);
    expect(isTransientStatus(503)).toBe(true);
  });

  it("returns false for client errors", () => {
    expect(isTransientStatus(400)).toBe(false);
    expect(isTransientStatus(404)).toBe(false);
    expect(isTransientStatus(401)).toBe(false);
  });

  it("returns false for success codes", () => {
    expect(isTransientStatus(200)).toBe(false);
  });
});

describe("isCredentialPaymentOrEntitlementStatus", () => {
  it("returns true for 402", () => {
    expect(isCredentialPaymentOrEntitlementStatus(402)).toBe(true);
  });

  it("returns false for other statuses", () => {
    expect(isCredentialPaymentOrEntitlementStatus(401)).toBe(false);
    expect(isCredentialPaymentOrEntitlementStatus(403)).toBe(false);
    expect(isCredentialPaymentOrEntitlementStatus(undefined)).toBe(false);
  });
});

describe("getStopFallbackApiCallError", () => {
  it("returns undefined for non-APICallError", () => {
    expect(getStopFallbackApiCallError(new Error("generic"))).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(getStopFallbackApiCallError(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(getStopFallbackApiCallError(undefined)).toBeUndefined();
  });

  it("returns undefined for transient status APICallError", () => {
    const err = new APICallError({
      message: "rate limited",
      statusCode: 429,
      url: "https://api.example.com",
      requestBodyValues: {},
      responseHeaders: {},
    });
    expect(getStopFallbackApiCallError(err)).toBeUndefined();
  });

  it("returns undefined for auth-invalid status APICallError", () => {
    const err = new APICallError({
      message: "unauthorized",
      statusCode: 401,
      url: "https://api.example.com",
      requestBodyValues: {},
      responseHeaders: {},
    });
    expect(getStopFallbackApiCallError(err)).toBeUndefined();
  });

  it("returns undefined for 402 payment status", () => {
    const err = new APICallError({
      message: "payment required",
      statusCode: 402,
      url: "https://api.example.com",
      requestBodyValues: {},
      responseHeaders: {},
    });
    expect(getStopFallbackApiCallError(err)).toBeUndefined();
  });

  it("returns undefined for 404 status", () => {
    const err = new APICallError({
      message: "not found",
      statusCode: 404,
      url: "https://api.example.com",
      requestBodyValues: {},
      responseHeaders: {},
    });
    expect(getStopFallbackApiCallError(err)).toBeUndefined();
  });

  it("returns the APICallError for non-transient non-auth status", () => {
    const err = new APICallError({
      message: "bad request",
      statusCode: 400,
      url: "https://api.example.com",
      requestBodyValues: {},
      responseHeaders: {},
    });
    const result = getStopFallbackApiCallError(err);
    expect(result).toBe(err);
  });

  it("traverses error causes to find APICallError", () => {
    const apiErr = new APICallError({
      message: "bad request",
      statusCode: 400,
      url: "https://api.example.com",
      requestBodyValues: {},
      responseHeaders: {},
    });
    const wrapper = new Error("wrapper", { cause: apiErr });
    const result = getStopFallbackApiCallError(wrapper);
    expect(result).toBe(apiErr);
  });

  it("returns undefined for no-status APICallError", () => {
    const err = new APICallError({
      message: "network error",
      statusCode: undefined,
      url: "https://api.example.com",
      requestBodyValues: {},
      responseHeaders: {},
    });
    expect(getStopFallbackApiCallError(err)).toBeUndefined();
  });
});

describe("resolveProviderBaseURL", () => {
  it("returns undefined when no URL is configured", () => {
    expect(
      resolveProviderBaseURL({
        providerApi: undefined,
        options: {},
        config: {},
      }),
    ).toBeUndefined();
  });

  it("returns baseURL from options", () => {
    expect(
      resolveProviderBaseURL({
        providerApi: undefined,
        options: { baseURL: "https://custom.api.com" },
      }),
    ).toBe("https://custom.api.com");
  });

  it("prefers options.baseURL over config.baseURL", () => {
    expect(
      resolveProviderBaseURL({
        providerApi: undefined,
        options: { baseURL: "https://opt.com" },
        config: { baseURL: "https://cfg.com" },
      }),
    ).toBe("https://opt.com");
  });

  it("falls back to options.baseUrl (camelCase)", () => {
    expect(
      resolveProviderBaseURL({
        providerApi: undefined,
        options: { baseUrl: "https://camel.com" },
      }),
    ).toBe("https://camel.com");
  });

  it("falls back to options.base_url (snake_case)", () => {
    expect(
      resolveProviderBaseURL({
        providerApi: undefined,
        options: { base_url: "https://snake.com" },
      }),
    ).toBe("https://snake.com");
  });

  it("falls back to config.baseURL", () => {
    expect(
      resolveProviderBaseURL({
        providerApi: undefined,
        options: {},
        config: { baseURL: "https://cfg.com" },
      }),
    ).toBe("https://cfg.com");
  });

  it("trims whitespace from URL values", () => {
    expect(
      resolveProviderBaseURL({
        providerApi: undefined,
        options: { baseURL: "  https://trimmed.com  " },
      }),
    ).toBe("https://trimmed.com");
  });

  it("ignores empty string URLs", () => {
    expect(
      resolveProviderBaseURL({
        providerApi: undefined,
        options: { baseURL: "  " },
      }),
    ).toBeUndefined();
  });

  it("interpolates template variables in providerApi", () => {
    expect(
      resolveProviderBaseURL({
        providerApi: "https://${REGION}.api.com/v1",
        config: { REGION: "us-east" },
      }),
    ).toBe("https://us-east.api.com/v1");
  });

  it("throws when template variables are unresolved", () => {
    expect(() =>
      resolveProviderBaseURL({
        providerApi: "https://${REGION}.api.com/v1",
        config: {},
      }),
    ).toThrow("requires values for REGION");
  });

  it("uses secrets for template interpolation", () => {
    expect(
      resolveProviderBaseURL({
        providerApi: "https://${HOST}.api.com",
        secrets: { HOST: "custom-host" },
      }),
    ).toBe("https://custom-host.api.com");
  });

  it("returns providerApi when it has no templates", () => {
    expect(
      resolveProviderBaseURL({
        providerApi: "https://static.api.com",
      }),
    ).toBe("https://static.api.com");
  });
});

describe("providerRequiresConfiguredAccount", () => {
  it("returns true when providerApi contains template variables", () => {
    expect(
      providerRequiresConfiguredAccount({
        providerApi: "https://${ACCOUNT_ID}.api.com",
        providerEnv: undefined,
      }),
    ).toBe(true);
  });

  it("returns true when providerEnv is not an array", () => {
    expect(
      providerRequiresConfiguredAccount({
        providerApi: "https://api.com",
        providerEnv: "some-env",
      }),
    ).toBe(true);
  });

  it("returns true when providerEnv array has non-empty strings", () => {
    expect(
      providerRequiresConfiguredAccount({
        providerApi: undefined,
        providerEnv: ["API_KEY"],
      }),
    ).toBe(true);
  });

  it("returns false when providerEnv array has only empty/non-string entries", () => {
    expect(
      providerRequiresConfiguredAccount({
        providerApi: undefined,
        providerEnv: ["", " ", 42],
      }),
    ).toBe(false);
  });

  it("returns false for empty env array with no template API", () => {
    expect(
      providerRequiresConfiguredAccount({
        providerApi: undefined,
        providerEnv: [],
      }),
    ).toBe(false);
  });
});
