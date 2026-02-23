import { describe, it, expect } from "vitest";
import { exchangeAuthorizationCode, refreshAccessToken, resolveOAuthEndpoints } from "../../src/modules/oauth/oauth-client.js";

describe("oauth-client", () => {
  it("coerces standard fields for x-www-form-urlencoded responses", async () => {
    const token = await refreshAccessToken({
      tokenEndpoint: "https://example.test/oauth/token",
      clientId: "client-id",
      tokenEndpointBasicAuth: false,
      refreshToken: "refresh-token",
      fetchImpl: async () =>
        new Response("access_token=abc&expires_in=3600&refresh_token=def&scope=read", {
          status: 200,
          headers: { "content-type": "application/x-www-form-urlencoded" },
        }),
    });

    expect(token.access_token).toBe("abc");
    expect(token.refresh_token).toBe("def");
    expect(token.expires_in).toBe(3600);
    expect(typeof token.expires_in).toBe("number");
    expect(token.scope).toBe("read");
  });

  it("does not send client_id in body when using token endpoint basic auth", async () => {
    const seen: { body?: string; authorization?: string } = {};
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen.body = String(init?.body ?? "");
      const headers = new Headers(init?.headers as HeadersInit);
      seen.authorization = headers.get("authorization") ?? undefined;
      return new Response(JSON.stringify({ access_token: "abc" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await refreshAccessToken({
      tokenEndpoint: "https://example.test/oauth/token",
      clientId: "client-id",
      clientSecret: "client-secret",
      tokenEndpointBasicAuth: true,
      refreshToken: "refresh-token",
      fetchImpl,
    });

    expect(seen.authorization).toMatch(/^Basic /);
    expect(seen.body).toContain("grant_type=refresh_token");
    expect(seen.body).not.toContain("client_id=");
    expect(seen.body).not.toContain("client_secret=");
  });

  it("sends client_id in body when not using token endpoint basic auth", async () => {
    let body = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ access_token: "abc" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await refreshAccessToken({
      tokenEndpoint: "https://example.test/oauth/token",
      clientId: "client-id",
      tokenEndpointBasicAuth: false,
      refreshToken: "refresh-token",
      fetchImpl,
    });

    expect(body).toContain("client_id=client-id");
  });

  it("skips OIDC discovery when auth and token endpoints are explicitly configured", async () => {
    const endpoints = await resolveOAuthEndpoints(
      {
        provider_id: "test",
        issuer: "https://issuer.example",
        authorization_endpoint: "https://issuer.example/oauth/authorize",
        token_endpoint: "https://issuer.example/oauth/token",
        scopes: [],
        token_endpoint_basic_auth: true,
      },
      {
        fetchImpl: async () => {
          throw new Error("discovery should not be called");
        },
      },
    );

    expect(endpoints.authorizationEndpoint).toBe("https://issuer.example/oauth/authorize");
    expect(endpoints.tokenEndpoint).toBe("https://issuer.example/oauth/token");
  });

  it("discovers missing endpoints via OIDC discovery when needed", async () => {
    const endpoints = await resolveOAuthEndpoints(
      {
        provider_id: "test",
        issuer: "https://issuer.example",
        scopes: [],
        token_endpoint_basic_auth: true,
      },
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              authorization_endpoint: "https://issuer.example/oauth/authorize",
              token_endpoint: "https://issuer.example/oauth/token",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
    );

    expect(endpoints.authorizationEndpoint).toBe("https://issuer.example/oauth/authorize");
    expect(endpoints.tokenEndpoint).toBe("https://issuer.example/oauth/token");
  });

  it("does not send client_id in auth-code exchange body when using token endpoint basic auth", async () => {
    let body = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ access_token: "abc" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await exchangeAuthorizationCode({
      tokenEndpoint: "https://example.test/oauth/token",
      clientId: "client-id",
      clientSecret: "client-secret",
      tokenEndpointBasicAuth: true,
      code: "code",
      redirectUri: "https://app.example/callback",
      pkceVerifier: "verifier",
      fetchImpl,
    });

    expect(body).not.toContain("client_id=");
    expect(body).not.toContain("client_secret=");
  });
});
