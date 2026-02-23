import { describe, expect, it } from "vitest";
import {
  DeviceTokenIssueRequest,
  DeviceTokenIssueResponse,
  DeviceTokenRevokeRequest,
  DeviceTokenRevokeResponse,
  DeviceTokenClaims,
} from "../src/index.js";

describe("Device token contracts", () => {
  it("parses issue request with normalized scopes", () => {
    const req = DeviceTokenIssueRequest.parse({
      device_id: "  dev_client_1  ",
      role: "client",
      scopes: [" operator.read ", "operator.write", "operator.read"],
      ttl_seconds: 900,
    });
    expect(req.device_id).toBe("dev_client_1");
    expect(req.scopes).toEqual(["operator.read", "operator.write"]);
    expect(req.ttl_seconds).toBe(900);
  });

  it("parses issue response", () => {
    const res = DeviceTokenIssueResponse.parse({
      token: "tyrum-device.v1.payload.sig",
      token_id: "tok_1",
      token_kind: "device",
      device_id: "dev_client_1",
      role: "client",
      scopes: ["operator.read"],
      issued_at: "2026-02-23T00:00:00.000Z",
      expires_at: "2026-02-23T00:15:00.000Z",
    });
    expect(res.token_id).toBe("tok_1");
    expect(res.role).toBe("client");
  });

  it("parses revoke request/response", () => {
    const req = DeviceTokenRevokeRequest.parse({ token: "tyrum-device.v1.payload.sig" });
    expect(req.token).toContain("tyrum-device.v1.");

    const res = DeviceTokenRevokeResponse.parse({
      revoked: true,
      token_id: "tok_1",
    });
    expect(res.revoked).toBe(true);
    expect(res.token_id).toBe("tok_1");
  });

  it("parses device token claims", () => {
    const claims = DeviceTokenClaims.parse({
      token_kind: "device",
      token_id: "tok_1",
      device_id: "dev_client_1",
      role: "client",
      scopes: ["operator.read"],
      issued_at: "2026-02-23T00:00:00.000Z",
      expires_at: "2026-02-23T00:15:00.000Z",
    });
    expect(claims.scopes).toEqual(["operator.read"]);
  });
});
