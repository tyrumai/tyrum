import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { VERIFICATION_TOKEN_FIXTURES } from "./fixtures";
import {
  persistConsent,
  resetConsentStore,
  type ConsentSelections,
} from "../consent/store";
import {
  PORTAL_SESSION_COOKIE,
  PORTAL_SESSION_SECRET_ENV,
  clearPortalSessionSecretForTesting,
  setPortalSessionSecretForTesting,
} from "../../../lib/portal-auth";

const ORIGIN = "https://example.com";

function createPostRequest() {
  return new NextRequest(`${ORIGIN}/api/onboarding/verify`, {
    method: "POST",
  });
}

const CONSENT_SELECTIONS: ConsentSelections = {
  shareCalendarSignals: true,
  allowPlannerAutonomy: false,
  retainAuditTrail: true,
};

describe("OnboardingVerify route", () => {
  const originalSecret = process.env[PORTAL_SESSION_SECRET_ENV];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-02-01T10:00:00.000Z"));
    setPortalSessionSecretForTesting(VERIFICATION_TOKEN_FIXTURES.secret);
  });

  afterEach(() => {
    clearPortalSessionSecretForTesting();
    if (originalSecret === undefined) {
      delete process.env[PORTAL_SESSION_SECRET_ENV];
    } else {
      process.env[PORTAL_SESSION_SECRET_ENV] = originalSecret;
    }

    resetConsentStore();
    vi.useRealTimers();
  });

  it("stamps a deterministic session cookie once consent is recorded", async () => {
    persistConsent(CONSENT_SELECTIONS);
    const request = createPostRequest();

    const response = await POST(request);

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload).toEqual({
      status: "verified",
      token: VERIFICATION_TOKEN_FIXTURES.success,
      expiresAt: "2025-02-01T11:00:00.000Z",
      revision: 1,
      auditReference: "CONSENT-STUB-0001",
    });

    const cookie = response.cookies.get(PORTAL_SESSION_COOKIE);
    expect(cookie?.value).toBe(VERIFICATION_TOKEN_FIXTURES.success);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.maxAge).toBe(60 * 60);
  });

  it("rejects verification when consent has not been captured", async () => {
    const request = createPostRequest();
    const response = await POST(request);

    expect(response.status).toBe(409);
    const payload = await response.json();

    expect(payload).toEqual({
      error: "consent_not_recorded",
      message:
        "Consent selections must be captured before the portal session can be verified.",
    });

    expect(response.cookies.get(PORTAL_SESSION_COOKIE)).toBeUndefined();
  });

  it("reports missing secret configuration", async () => {
    setPortalSessionSecretForTesting(undefined);
    persistConsent(CONSENT_SELECTIONS);

    const response = await POST(createPostRequest());

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload).toEqual({
      error: "configuration_error",
      message:
        "PORTAL_SESSION_SECRET must be configured for portal verification stubs.",
    });
  });
});
