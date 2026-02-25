import { describe, expect, it } from "vitest";
import {
  SecretHandle,
  SecretListResponse,
  SecretResolveRequest,
  SecretResolveResponse,
  SecretRevokeRequest,
  SecretRevokeResponse,
  SecretStoreRequest,
  SecretRotateRequest,
  SecretRotateResponse,
} from "../src/index.js";

describe("Secret contracts", () => {
  it("parses secret handle", () => {
    const handle = SecretHandle.parse({
      handle_id: "h-1",
      provider: "env",
      scope: "MY_API_KEY",
      created_at: "2026-02-19T12:00:00Z",
    });
    expect(handle.provider).toBe("env");
  });

  it("parses store request", () => {
    const req = SecretStoreRequest.parse({
      scope: "  MY_API_KEY  ",
      value: "secret",
      provider: "env",
    });
    expect(req.scope).toBe("MY_API_KEY");
  });

  it("parses rotate request/response", () => {
    const req = SecretRotateRequest.parse({ value: "  new-secret  " });
    expect(req.value).toBe("new-secret");

    const res = SecretRotateResponse.parse({
      revoked: true,
      handle: {
        handle_id: "h-2",
        provider: "file",
        scope: "DB_PASSWORD",
        created_at: "2026-02-19T12:00:00Z",
      },
    });
    expect(res.revoked).toBe(true);
    expect(res.handle.handle_id).toBe("h-2");
  });

  it("parses resolve request/response", () => {
    const req = SecretResolveRequest.parse({ handle_id: "h-1" });
    expect(req.handle_id).toBe("h-1");

    const res = SecretResolveResponse.parse({ value: "secret" });
    expect(res.value).toBe("secret");
  });

  it("parses list response", () => {
    const res = SecretListResponse.parse({
      handles: [
        {
          handle_id: "h-1",
          provider: "file",
          scope: "DB_PASSWORD",
          created_at: "2026-02-19T12:00:00Z",
        },
      ],
    });
    expect(res.handles).toHaveLength(1);
  });

  it("parses revoke request/response", () => {
    const req = SecretRevokeRequest.parse({ handle_id: "h-1" });
    expect(req.handle_id).toBe("h-1");

    const res = SecretRevokeResponse.parse({ revoked: true });
    expect(res.revoked).toBe(true);
  });
});
