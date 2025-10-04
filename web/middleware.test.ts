import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";
import {
  CTA_FROM_PARAM,
  CTA_REDIRECT_PARAM,
  CTA_REDIRECT_REASON,
  PORTAL_SESSION_COOKIE,
} from "./app/lib/portal-auth";

const origin = "https://example.com";

type RequestOptions = {
  cookie?: string;
};

function createRequest(path: string, options: RequestOptions = {}) {
  const headers = new Headers();

  if (options.cookie !== undefined) {
    headers.set("cookie", `${PORTAL_SESSION_COOKIE}=${options.cookie}`);
  }

  return new NextRequest(`${origin}${path}`, { headers });
}

describe("middleware", () => {
  it("redirects unauthenticated portal traffic to the onboarding CTA", () => {
    const response = middleware(createRequest("/portal/cases"));

    expect(response.status).toBe(307);

    const location = response.headers.get("location");
    expect(location).toBeTruthy();

    const redirectUrl = new URL(location ?? "", origin);

    expect(redirectUrl.pathname).toBe("/");
    expect(redirectUrl.searchParams.get(CTA_REDIRECT_PARAM)).toBe(
      CTA_REDIRECT_REASON,
    );
    expect(redirectUrl.searchParams.get(CTA_FROM_PARAM)).toBe("/portal/cases");
  });

  it("passes through when a session cookie is present", () => {
    const response = middleware(createRequest("/portal", { cookie: "token" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not guard onboarding or auth routes", () => {
    const onboarding = middleware(createRequest("/portal/onboarding"));
    const auth = middleware(createRequest("/portal/auth/reset"));

    expect(onboarding.status).toBe(200);
    expect(onboarding.headers.get("location")).toBeNull();
    expect(auth.status).toBe(200);
    expect(auth.headers.get("location")).toBeNull();
  });
});
