import { describe, expect, it } from "vitest";
import {
  toGatewayAppUrl,
  toHttpAppUrlFromWsUrl,
} from "../src/renderer/lib/gateway-ui.js";

describe("toHttpAppUrlFromWsUrl", () => {
  it("converts ws URL to http /app URL", () => {
    expect(toHttpAppUrlFromWsUrl("ws://127.0.0.1:8080/ws")).toBe(
      "http://127.0.0.1:8080/app",
    );
  });

  it("converts wss URL to https /app URL", () => {
    expect(toHttpAppUrlFromWsUrl("wss://example.com/ws")).toBe(
      "https://example.com/app",
    );
  });

  it("accepts http URL and normalizes to /app path", () => {
    expect(toHttpAppUrlFromWsUrl("http://localhost:9999/foo")).toBe(
      "http://localhost:9999/app",
    );
  });

  it("returns null for invalid URL", () => {
    expect(toHttpAppUrlFromWsUrl("not-a-url")).toBeNull();
  });
});

describe("toGatewayAppUrl", () => {
  it("returns embedded app URL for embedded mode", () => {
    expect(
      toGatewayAppUrl({
        mode: "embedded",
        embedded: { port: 8088 },
      }),
    ).toBe("http://127.0.0.1:8088/app");
  });

  it("returns remote app URL for remote mode", () => {
    expect(
      toGatewayAppUrl({
        mode: "remote",
        remote: { wsUrl: "ws://remote-host:8080/ws" },
      }),
    ).toBe("http://remote-host:8080/app");
  });
});
