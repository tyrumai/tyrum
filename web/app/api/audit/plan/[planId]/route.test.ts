import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const originalFetch = global.fetch;
const originalApiBaseUrl = process.env.API_BASE_URL;

describe("audit plan route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.API_BASE_URL = "https://api.example.com";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiBaseUrl === undefined) {
      delete process.env.API_BASE_URL;
    } else {
      process.env.API_BASE_URL = originalApiBaseUrl;
    }
  });

  it("forwards query parameters to the upstream API", async () => {
    const responsePayload = JSON.stringify({ plan_id: "demo", events: [] });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(responsePayload, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const request = new Request(
      "https://portal.local/api/audit/plan/demo?event=abc123",
    );

    await GET(request, {
      params: Promise.resolve({ planId: "demo" }),
    });

    const [calledUrl, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe(
      "https://api.example.com/audit/plan/demo?event=abc123",
    );
    expect(init).toMatchObject({ method: "GET" });
  });
});
