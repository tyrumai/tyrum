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
import { expectRejects } from "./test-helpers.js";

const baseHandle = {
  handle_id: "h-1",
  provider: "db",
  scope: "db_password",
  created_at: "2026-02-19T12:00:00Z",
} as const;

describe("SecretHandle", () => {
  it("parses secret handle", () => {
    const handle = SecretHandle.parse(baseHandle);
    expect(handle.provider).toBe("db");
  });

  it("rejects secret handle missing handle_id", () => {
    const bad = { ...baseHandle } as Record<string, unknown>;
    delete bad.handle_id;
    expectRejects(SecretHandle, bad);
  });

  it("rejects secret handle with invalid provider", () => {
    expectRejects(SecretHandle, { ...baseHandle, provider: "unknown" });
  });
});

describe("SecretStoreRequest", () => {
  it("parses store request", () => {
    const req = SecretStoreRequest.parse({
      secret_key: "  db_password  ",
      value: "secret",
    });
    expect(req.secret_key).toBe("db_password");
  });

  it("rejects store request with blank secret_key", () => {
    expectRejects(SecretStoreRequest, { secret_key: "   ", value: "secret" });
  });

  it("rejects store request with unknown fields", () => {
    expectRejects(SecretStoreRequest, {
      secret_key: "db_password",
      value: "secret",
      provider: "env",
    });
  });
});

describe("SecretRotateRequest/Response", () => {
  it("parses rotate request/response", () => {
    const req = SecretRotateRequest.parse({ value: "  new-secret  " });
    expect(req.value).toBe("  new-secret  ");

    const res = SecretRotateResponse.parse({
      revoked: true,
      handle: {
        handle_id: "h-2",
        provider: "db",
        scope: "h-2",
        created_at: "2026-02-19T12:00:00Z",
      },
    });
    expect(res.revoked).toBe(true);
    expect(res.handle.handle_id).toBe("h-2");
  });

  it("rejects rotate request with missing value", () => {
    expectRejects(SecretRotateRequest, {});
  });

  it("rejects rotate response with wrong revoked type", () => {
    expectRejects(SecretRotateResponse, { revoked: "true", handle: baseHandle });
  });
});

describe("SecretResolveRequest/Response", () => {
  it("parses resolve request/response", () => {
    const req = SecretResolveRequest.parse({ handle_id: "h-1" });
    expect(req.handle_id).toBe("h-1");

    const res = SecretResolveResponse.parse({ value: "secret" });
    expect(res.value).toBe("secret");
  });

  it("rejects resolve request with wrong handle_id type", () => {
    expectRejects(SecretResolveRequest, { handle_id: 1 });
  });

  it("rejects resolve response with non-string value", () => {
    expectRejects(SecretResolveResponse, { value: 42 });
  });
});

describe("SecretListResponse", () => {
  it("parses list response", () => {
    const res = SecretListResponse.parse({
      handles: [
        {
          handle_id: "h-1",
          provider: "db",
          scope: "h-1",
          created_at: "2026-02-19T12:00:00Z",
        },
      ],
    });
    expect(res.handles).toHaveLength(1);
  });

  it("rejects list response with handles that are not an array", () => {
    expectRejects(SecretListResponse, { handles: "nope" });
  });

  it("rejects list response with malformed handle entries", () => {
    expectRejects(SecretListResponse, { handles: [{ handle_id: "h-1" }] });
  });
});

describe("SecretRevokeRequest/Response", () => {
  it("parses revoke request/response", () => {
    const req = SecretRevokeRequest.parse({ handle_id: "h-1" });
    expect(req.handle_id).toBe("h-1");

    const res = SecretRevokeResponse.parse({ revoked: true });
    expect(res.revoked).toBe(true);
  });

  it("rejects revoke request missing handle_id", () => {
    expectRejects(SecretRevokeRequest, {});
  });

  it("rejects revoke response with wrong revoked type", () => {
    expectRejects(SecretRevokeResponse, { revoked: "yes" });
  });
});
