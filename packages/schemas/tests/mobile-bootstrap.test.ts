import { describe, expect, it } from "vitest";
import {
  MobileBootstrapPayload,
  createMobileBootstrapUrl,
  inferGatewayWsUrl,
  normalizeGatewayHttpBaseUrl,
  parseMobileBootstrapUrl,
} from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("mobile bootstrap payload", () => {
  const payload = {
    v: 1 as const,
    httpBaseUrl: "https://gateway.example",
    wsUrl: "wss://gateway.example/ws",
    token: "tyrum-token.v1.mobile.secret",
  };

  it("parses the payload schema", () => {
    expect(MobileBootstrapPayload.parse(payload)).toEqual(payload);
  });

  it("round-trips a tyrum bootstrap URL", () => {
    const url = createMobileBootstrapUrl(payload);
    expect(url.startsWith("tyrum://bootstrap?payload=")).toBe(true);
    expect(parseMobileBootstrapUrl(url)).toEqual(payload);
  });

  it("infers a websocket URL from the gateway HTTP base URL", () => {
    expect(inferGatewayWsUrl("https://gateway.example/")).toBe("wss://gateway.example/ws");
    expect(inferGatewayWsUrl("http://gateway.example")).toBe("ws://gateway.example/ws");
    expect(inferGatewayWsUrl("wss://gateway.example/ws")).toBe("wss://gateway.example/ws");
  });

  it("normalizes the gateway HTTP base URL without regex backtracking", () => {
    expect(normalizeGatewayHttpBaseUrl("https://gateway.example///")).toBe(
      "https://gateway.example",
    );
    expect(normalizeGatewayHttpBaseUrl(" https://gateway.example/path ")).toBe(
      "https://gateway.example/path",
    );
  });

  it("rejects payloads with non-http gateway URLs", () => {
    expectRejects(MobileBootstrapPayload, {
      ...payload,
      httpBaseUrl: "ftp://gateway.example",
    });
  });

  it("rejects payloads with non-websocket URLs", () => {
    expectRejects(MobileBootstrapPayload, {
      ...payload,
      wsUrl: "https://gateway.example/ws",
    });
  });

  it("rejects bootstrap URLs with invalid versions", () => {
    const encoded = Buffer.from(
      JSON.stringify({
        ...payload,
        v: 2,
      }),
      "utf-8",
    ).toString("base64url");

    expect(() => parseMobileBootstrapUrl(`tyrum://bootstrap?payload=${encoded}`)).toThrow(
      /Invalid literal value|Invalid input: expected 1/,
    );
  });

  it("rejects malformed bootstrap payloads", () => {
    expect(() => parseMobileBootstrapUrl("tyrum://bootstrap?payload=%%%")).toThrow(/base64url/i);
    expect(() => parseMobileBootstrapUrl("tyrum://bootstrap")).toThrow(/missing the payload/i);
    expect(() => parseMobileBootstrapUrl("https://gateway.example")).toThrow(/Expected tyrum/i);
  });
});
