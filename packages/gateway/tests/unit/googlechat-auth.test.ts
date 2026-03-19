import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { oauth2ClientCtorMock, verifyIdTokenMock, verifySignedJwtWithCertsAsyncMock } = vi.hoisted(
  () => {
    const verifyIdTokenFn = vi.fn();
    const verifySignedJwtWithCertsAsyncFn = vi.fn();
    const oauth2ClientCtorFn = vi.fn(() => ({
      verifyIdToken: verifyIdTokenFn,
      verifySignedJwtWithCertsAsync: verifySignedJwtWithCertsAsyncFn,
    }));
    return {
      oauth2ClientCtorMock: oauth2ClientCtorFn,
      verifyIdTokenMock: verifyIdTokenFn,
      verifySignedJwtWithCertsAsyncMock: verifySignedJwtWithCertsAsyncFn,
    };
  },
);

vi.mock("google-auth-library", () => ({
  OAuth2Client: class OAuth2Client {
    verifyIdToken = verifyIdTokenMock;
    verifySignedJwtWithCertsAsync = verifySignedJwtWithCertsAsyncMock;

    constructor() {
      oauth2ClientCtorMock();
    }
  },
}));

type VerifyGoogleChatRequest =
  typeof import("../../src/modules/ingress/googlechat-auth.js").verifyGoogleChatRequest;

async function loadVerifyGoogleChatRequest(): Promise<VerifyGoogleChatRequest> {
  const module = await import("../../src/modules/ingress/googlechat-auth.js");
  return module.verifyGoogleChatRequest;
}

describe("verifyGoogleChatRequest", () => {
  beforeEach(() => {
    vi.resetModules();
    oauth2ClientCtorMock.mockReset();
    verifyIdTokenMock.mockReset();
    verifySignedJwtWithCertsAsyncMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects missing bearer tokens, missing audiences, and unsupported audience types", async () => {
    const verifyGoogleChatRequest = await loadVerifyGoogleChatRequest();

    await expect(
      verifyGoogleChatRequest({
        audienceType: "app-url",
        audience: "https://example.test/googlechat",
      }),
    ).resolves.toEqual({ ok: false, reason: "missing token" });

    await expect(
      verifyGoogleChatRequest({
        bearer: "token",
        audienceType: "app-url",
      }),
    ).resolves.toEqual({ ok: false, reason: "missing audience" });

    await expect(
      verifyGoogleChatRequest({
        bearer: "token",
        audienceType: undefined,
        audience: "https://example.test/googlechat",
      }),
    ).resolves.toEqual({ ok: false, reason: "unsupported audience type" });
  });

  it("validates app-url tokens for Chat and add-on issuers and rejects invalid issuers", async () => {
    const verifyGoogleChatRequest = await loadVerifyGoogleChatRequest();

    verifyIdTokenMock
      .mockResolvedValueOnce({
        getPayload: () => ({
          email_verified: true,
          email: " CHAT@SYSTEM.GSERVICEACCOUNT.COM ",
        }),
      })
      .mockResolvedValueOnce({
        getPayload: () => ({
          email_verified: true,
          email: "service-123@gcp-sa-gsuiteaddons.iam.gserviceaccount.com",
        }),
      })
      .mockResolvedValueOnce({
        getPayload: () => ({
          email_verified: false,
          email: "chat@system.gserviceaccount.com",
        }),
      })
      .mockResolvedValueOnce({
        getPayload: () => ({
          email_verified: true,
          email: "user@example.com",
        }),
      })
      .mockRejectedValueOnce(new Error("invalid token"));

    await expect(
      verifyGoogleChatRequest({
        bearer: "chat-token",
        audienceType: "app-url",
        audience: "https://example.test/googlechat",
      }),
    ).resolves.toEqual({ ok: true });

    await expect(
      verifyGoogleChatRequest({
        bearer: "addon-token",
        audienceType: "app-url",
        audience: "https://example.test/googlechat",
      }),
    ).resolves.toEqual({ ok: true });

    await expect(
      verifyGoogleChatRequest({
        bearer: "unverified-token",
        audienceType: "app-url",
        audience: "https://example.test/googlechat",
      }),
    ).resolves.toEqual({ ok: false, reason: "email not verified" });

    await expect(
      verifyGoogleChatRequest({
        bearer: "invalid-issuer-token",
        audienceType: "app-url",
        audience: "https://example.test/googlechat",
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid issuer: user@example.com" });

    await expect(
      verifyGoogleChatRequest({
        bearer: "bad-token",
        audienceType: "app-url",
        audience: "https://example.test/googlechat",
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid token" });

    expect(verifyIdTokenMock).toHaveBeenCalledTimes(5);
  });

  it("validates project-number tokens and reuses the cached Chat certificates", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ key1: "cert1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    verifySignedJwtWithCertsAsyncMock.mockResolvedValue(undefined);

    const verifyGoogleChatRequest = await loadVerifyGoogleChatRequest();

    await expect(
      verifyGoogleChatRequest({
        bearer: "project-token-1",
        audienceType: "project-number",
        audience: "123456789",
      }),
    ).resolves.toEqual({ ok: true });

    await expect(
      verifyGoogleChatRequest({
        bearer: "project-token-2",
        audienceType: "project-number",
        audience: "123456789",
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(verifySignedJwtWithCertsAsyncMock).toHaveBeenCalledTimes(2);
    expect(verifySignedJwtWithCertsAsyncMock).toHaveBeenNthCalledWith(
      1,
      "project-token-1",
      { key1: "cert1" },
      "123456789",
      ["chat@system.gserviceaccount.com"],
    );
  });

  it("surfaces project-number certificate and signature failures", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));

    let verifyGoogleChatRequest = await loadVerifyGoogleChatRequest();
    await expect(
      verifyGoogleChatRequest({
        bearer: "project-token",
        audienceType: "project-number",
        audience: "123456789",
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "Failed to fetch Google Chat certs (503)",
    });

    vi.resetModules();
    verifyIdTokenMock.mockReset();
    verifySignedJwtWithCertsAsyncMock.mockReset();

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ key1: "cert1" }), { status: 200 }),
    );
    verifySignedJwtWithCertsAsyncMock.mockRejectedValueOnce(new Error("invalid signature"));

    verifyGoogleChatRequest = await loadVerifyGoogleChatRequest();
    await expect(
      verifyGoogleChatRequest({
        bearer: "project-token",
        audienceType: "project-number",
        audience: "123456789",
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid signature",
    });
  });

  it("retries client creation after a transient initialization failure", async () => {
    oauth2ClientCtorMock
      .mockImplementationOnce(() => {
        throw new Error("transient init failure");
      })
      .mockImplementation(() => {});
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        email_verified: true,
        email: "chat@system.gserviceaccount.com",
      }),
    });

    const verifyGoogleChatRequest = await loadVerifyGoogleChatRequest();

    const first = await verifyGoogleChatRequest({
      bearer: "chat-token-a",
      audienceType: "app-url",
      audience: "https://example.test/googlechat",
    });
    const second = await verifyGoogleChatRequest({
      bearer: "chat-token-b",
      audienceType: "app-url",
      audience: "https://example.test/googlechat",
    });

    expect(first).toEqual({
      ok: false,
      reason: "google-auth-library is required for Google Chat auth: transient init failure",
    });
    expect(second).toEqual({ ok: true });
    expect(oauth2ClientCtorMock).toHaveBeenCalledTimes(2);
    expect(verifyIdTokenMock).toHaveBeenCalledOnce();
  });
});
