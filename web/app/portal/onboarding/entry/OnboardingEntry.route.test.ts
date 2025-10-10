import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { PORTAL_SESSION_COOKIE } from "../../../lib/portal-auth";
import { POST } from "./route";

const ORIGIN = "https://example.com";

function createFormRequest(entries: Record<string, string>) {
  const form = new URLSearchParams(entries);
  return new NextRequest(`${ORIGIN}/portal/onboarding/entry`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
}

describe("OnboardingEntry route", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("redirects to onboarding start and stamps a session placeholder", async () => {
    const responsePayload = { status: "created" };
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(responsePayload), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      ) as unknown as typeof fetch;

    const request = createFormRequest({
      email: "founder@example.com",
      utm_source: "ads",
    });

    const response = await POST(request);

    expect(response.status).toBe(303);

    const location = response.headers.get("location");
    expect(location).toBe(`${ORIGIN}/portal/onboarding/start?flash=waitlist-welcome&signup_status=created&utm_source=ads`);

    const cookie = response.cookies.get(PORTAL_SESSION_COOKIE);
    expect(cookie?.value).toMatch(/^onboarding-/);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.path).toBe("/");
  });

  it("redirects back to the landing page when email validation fails", async () => {
    const request = createFormRequest({
      email: "   ",
    });

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/?waitlist_status=invalid_email`,
    );
  });

  it("routes to onboarding even when the waitlist notes a duplicate signup", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "duplicate" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      ) as unknown as typeof fetch;

    const request = createFormRequest({
      email: "founder@example.com",
    });

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/portal/onboarding/start?flash=waitlist-existing&signup_status=duplicate`,
    );
  });

  it("keeps campaign parameters when redirecting back on upstream failure", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("offline")) as unknown as typeof fetch;

    const request = createFormRequest({
      email: "founder@example.com",
      utm_source: "ads",
      utm_campaign: "launch",
    });

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/?waitlist_status=error&waitlist_email=founder%40example.com&utm_source=ads&utm_campaign=launch`,
    );
  });
});
