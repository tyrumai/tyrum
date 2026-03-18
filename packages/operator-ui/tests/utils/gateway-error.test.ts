import { describe, expect, it } from "vitest";
import { readGatewayError, truncateText } from "../../src/utils/gateway-error.js";

describe("gateway error helpers", () => {
  it("truncates long text without changing short text", () => {
    expect(truncateText("short", 10)).toBe("short");
    expect(truncateText("abcdefghijklmnopqrstuvwxyz", 5)).toBe("abcde…");
  });

  it("reads structured JSON gateway errors and falls back to the error key", async () => {
    await expect(
      readGatewayError(
        new Response(JSON.stringify({ message: "  Detailed failure  " }), {
          status: 400,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        }),
      ),
    ).resolves.toBe("Detailed failure");

    await expect(
      readGatewayError(
        new Response(JSON.stringify({ error: "gateway_unavailable" }), {
          status: 503,
          headers: {
            "content-type": "application/problem+json",
          },
        }),
      ),
    ).resolves.toBe("gateway_unavailable");
  });

  it("falls back to status codes and truncated plain text when JSON parsing is unavailable", async () => {
    const brokenResponse = {
      status: 502,
      headers: new Headers(),
      text: async () => {
        throw new Error("socket closed");
      },
    } as Response;

    await expect(readGatewayError(brokenResponse)).resolves.toBe("HTTP 502");

    await expect(
      readGatewayError(
        new Response("x".repeat(320), {
          status: 500,
          headers: {
            "content-type": "text/plain",
          },
        }),
      ),
    ).resolves.toBe(`${"x".repeat(300)}…`);

    await expect(
      readGatewayError(
        new Response("   ", {
          status: 404,
        }),
      ),
    ).resolves.toBe("HTTP 404");
  });
});
