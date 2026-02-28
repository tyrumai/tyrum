import { describe, expect, it } from "vitest";
import {
  DeviceTokenIssueRequest,
  DeviceTokenIssueResponse,
  DeviceTokenRevokeRequest,
  DeviceTokenRevokeResponse,
  DeviceTokenClaims,
} from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("Device token contracts", () => {
  const baseIssueRequest = {
    device_id: "dev_client_1",
    role: "client",
    scopes: ["operator.read"],
    ttl_seconds: 900,
  } as const;

  const baseIssueResponse = {
    token: "tyrum-device.v1.payload.sig",
    token_id: "tok_1",
    token_kind: "device",
    device_id: "dev_client_1",
    role: "client",
    scopes: ["operator.read"],
    issued_at: "2026-02-23T00:00:00.000Z",
    expires_at: "2026-02-23T00:15:00.000Z",
  } as const;

  const baseClaims = {
    token_kind: "device",
    token_id: "tok_1",
    device_id: "dev_client_1",
    role: "client",
    scopes: ["operator.read"],
    issued_at: "2026-02-23T00:00:00.000Z",
    expires_at: "2026-02-23T00:15:00.000Z",
  } as const;

  it("parses issue request with trimmed scopes", () => {
    const req = DeviceTokenIssueRequest.parse({
      device_id: "  dev_client_1  ",
      role: "client",
      scopes: [" operator.read ", "operator.write", "operator.read"],
      ttl_seconds: 900,
    });
    expect(req.device_id).toBe("dev_client_1");
    expect(req.scopes).toEqual(["operator.read", "operator.write", "operator.read"]);
    expect(req.ttl_seconds).toBe(900);
  });

  it("rejects issue request with wrong device_id type", () => {
    expectRejects(DeviceTokenIssueRequest, { ...baseIssueRequest, device_id: 123 });
  });

  it("rejects issue request with scopes that are not an array", () => {
    expectRejects(DeviceTokenIssueRequest, { ...baseIssueRequest, scopes: "operator.read" });
  });

  it("parses issue response", () => {
    const res = DeviceTokenIssueResponse.parse(baseIssueResponse);
    expect(res.token_id).toBe("tok_1");
    expect(res.role).toBe("client");
  });

  it("rejects issue response missing token", () => {
    const bad = { ...baseIssueResponse } as Record<string, unknown>;
    delete bad.token;
    expectRejects(DeviceTokenIssueResponse, bad);
  });

  it("rejects issue response with invalid role", () => {
    expectRejects(DeviceTokenIssueResponse, { ...baseIssueResponse, role: "operator" });
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

  it("rejects revoke request missing token", () => {
    expectRejects(DeviceTokenRevokeRequest, {});
  });

  it("rejects revoke response with wrong revoked type", () => {
    expectRejects(DeviceTokenRevokeResponse, { revoked: "true", token_id: "tok_1" });
  });

  it("parses device token claims", () => {
    const claims = DeviceTokenClaims.parse(baseClaims);
    expect(claims.scopes).toEqual(["operator.read"]);
  });

  it("rejects device token claims missing token_kind", () => {
    const bad = { ...baseClaims } as Record<string, unknown>;
    delete bad.token_kind;
    expectRejects(DeviceTokenClaims, bad);
  });

  it("rejects device token claims with extra token field", () => {
    expectRejects(DeviceTokenClaims, { ...baseClaims, token: "tyrum-device.v1.payload.sig" });
  });

  it("rejects device token claims with wrong expires_at type", () => {
    expectRejects(DeviceTokenClaims, { ...baseClaims, expires_at: 123 });
  });
});
