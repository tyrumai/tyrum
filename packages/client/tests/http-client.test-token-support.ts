import { expect, it, vi } from "vitest";
import type { RequestInit } from "undici";
import {
  createTestClient,
  getHeader,
  jsonResponse,
  makeFetchMock,
} from "./http-client.test-support.js";

export function registerHttpClientTokenTests(): void {
  it("lists tenant auth tokens and validates the response", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        tokens: [
          {
            token_id: "tid_1",
            tenant_id: "11111111-1111-4111-8111-111111111111",
            display_name: "Admin token",
            role: "admin",
            device_id: null,
            scopes: ["*"],
            issued_at: "2026-02-25T12:00:00.000Z",
            expires_at: null,
            revoked_at: null,
            created_at: "2026-02-25T12:00:00.000Z",
            updated_at: "2026-02-25T12:00:00.000Z",
            created_by: { kind: "http.auth_token.issue", issued_by: "root-token-id" },
          },
        ],
      }),
    );
    const client = createTestClient({ fetch });

    const result = await client.authTokens.list();

    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]?.role).toBe("admin");
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/auth/tokens");
    expect(init.method).toBe("GET");
  });

  it("issues tenant auth tokens and validates the response", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse(
        {
          token: "tyrum-token.v1.token-id.secret",
          token_id: "tid_1",
          tenant_id: "11111111-1111-4111-8111-111111111111",
          display_name: "Admin token",
          role: "admin",
          scopes: ["*"],
          issued_at: "2026-02-25T12:00:00.000Z",
          updated_at: "2026-02-25T12:00:00.000Z",
        },
        201,
      ),
    );
    const client = createTestClient({ fetch });

    const issued = await client.authTokens.issue({
      role: "admin",
      scopes: ["*"],
    });

    expect(issued.role).toBe("admin");
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/auth/tokens/issue");
    expect(init.method).toBe("POST");
    expect(getHeader(init, "content-type")).toBe("application/json");
  });

  it("updates tenant auth tokens and validates the response", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        token: {
          token_id: "tid_1",
          tenant_id: "11111111-1111-4111-8111-111111111111",
          display_name: "Updated token",
          role: "client",
          device_id: "device-2",
          scopes: ["operator.read", "operator.write"],
          issued_at: "2026-02-25T12:00:00.000Z",
          expires_at: null,
          revoked_at: null,
          created_at: "2026-02-25T12:00:00.000Z",
          updated_at: "2026-02-26T12:00:00.000Z",
          created_by: { kind: "http.auth_token.issue", issued_by: "root-token-id" },
        },
      }),
    );
    const client = createTestClient({ fetch });

    const updated = await client.authTokens.update("tid_1", {
      display_name: "Updated token",
      device_id: "device-2",
      scopes: ["operator.read", "operator.write"],
    });

    expect(updated.token.display_name).toBe("Updated token");
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/auth/tokens/tid_1");
    expect(init.method).toBe("PATCH");
    expect(getHeader(init, "content-type")).toBe("application/json");
  });

  it("revokes tenant auth tokens by token_id", async () => {
    const fetch = makeFetchMock(async () => jsonResponse({ revoked: true, token_id: "tid_1" }));
    const client = createTestClient({ fetch });

    const result = await client.authTokens.revoke({ token_id: "tid_1" });

    expect(result).toEqual({ revoked: true, token_id: "tid_1" });
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/auth/tokens/revoke");
    expect(init.method).toBe("POST");
  });
}
