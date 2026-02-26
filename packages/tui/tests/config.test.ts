import { describe, expect, it } from "vitest";
import { resolveGatewayUrls } from "../src/config.js";

describe("tui config", () => {
  describe("resolveGatewayUrls", () => {
    it("derives wsUrl from an http base url", () => {
      expect(resolveGatewayUrls("http://127.0.0.1:8788")).toEqual({
        httpBaseUrl: "http://127.0.0.1:8788",
        wsUrl: "ws://127.0.0.1:8788/ws",
      });
    });

    it("derives wssUrl from an https base url", () => {
      expect(resolveGatewayUrls("https://example.com")).toEqual({
        httpBaseUrl: "https://example.com",
        wsUrl: "wss://example.com/ws",
      });
    });

    it("derives http base url from a ws url", () => {
      expect(resolveGatewayUrls("ws://example.com:123/ws")).toEqual({
        httpBaseUrl: "http://example.com:123",
        wsUrl: "ws://example.com:123/ws",
      });
    });

    it("accepts host:port without scheme", () => {
      expect(resolveGatewayUrls("example.com:8788")).toEqual({
        httpBaseUrl: "http://example.com:8788",
        wsUrl: "ws://example.com:8788/ws",
      });
    });
  });
});

