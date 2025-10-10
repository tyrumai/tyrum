import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";
import {
  CTA_FROM_PARAM,
  CTA_REDIRECT_PARAM,
  CTA_REDIRECT_REASON,
  PORTAL_SESSION_COOKIE,
  PORTAL_SESSION_SECRET_ENV,
  clearPortalSessionSecretForTesting,
  setPortalSessionSecretForTesting,
} from "./app/lib/portal-auth";
import { VERIFICATION_TOKEN_FIXTURES } from "./app/api/onboarding/verify/fixtures";

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
  const originalSecret = process.env[PORTAL_SESSION_SECRET_ENV];

  beforeEach(() => {
    setPortalSessionSecretForTesting(VERIFICATION_TOKEN_FIXTURES.secret);
  });

  afterEach(() => {
    clearPortalSessionSecretForTesting();
    if (originalSecret === undefined) {
      delete process.env[PORTAL_SESSION_SECRET_ENV];
    } else {
      process.env[PORTAL_SESSION_SECRET_ENV] = originalSecret;
    }
  });

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

  it("passes through when a verified session cookie is present", () => {
    const response = middleware(
      createRequest("/portal", { cookie: VERIFICATION_TOKEN_FIXTURES.success }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects when the portal cookie is invalid", () => {
    const response = middleware(
      createRequest("/portal", { cookie: VERIFICATION_TOKEN_FIXTURES.invalid }),
    );

    expect(response.status).toBe(307);
    const redirect = response.headers.get("location");
    const url = new URL(redirect ?? "", origin);
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get(CTA_REDIRECT_PARAM)).toBe(
      CTA_REDIRECT_REASON,
    );
  });

  it("does not guard onboarding or auth routes", () => {
    const onboarding = middleware(createRequest("/portal/onboarding"));
    const onboardingStart = middleware(createRequest("/portal/onboarding/start"));
    const onboardingEntry = middleware(createRequest("/portal/onboarding/entry"));
    const auth = middleware(createRequest("/portal/auth/reset"));

    expect(onboarding.status).toBe(200);
    expect(onboarding.headers.get("location")).toBeNull();
    expect(onboardingStart.status).toBe(200);
    expect(onboardingStart.headers.get("location")).toBeNull();
    expect(onboardingEntry.status).toBe(200);
    expect(onboardingEntry.headers.get("location")).toBeNull();
    expect(auth.status).toBe(200);
    expect(auth.headers.get("location")).toBeNull();
  });
});
