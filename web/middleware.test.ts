import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const origin = "https://example.com";

function createRequest(path: string) {
  return new NextRequest(`${origin}${path}`);
}

describe("middleware", () => {
  it("allows portal routes without session checks", () => {
    const response = middleware(createRequest("/portal/settings"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows non-portal routes", () => {
    const response = middleware(createRequest("/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
