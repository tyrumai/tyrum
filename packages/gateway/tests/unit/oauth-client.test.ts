import { describe, it, expect } from "vitest";
import { refreshAccessToken } from "../../src/modules/oauth/oauth-client.js";

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
});

