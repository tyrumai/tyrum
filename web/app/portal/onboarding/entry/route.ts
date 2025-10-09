import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { PORTAL_SESSION_COOKIE } from "../../../lib/portal-auth";
import {
  CAMPAIGN_PARAM_KEYS,
  type CampaignParams,
} from "../../../lib/campaign";

type WaitlistStatus = "invalid_email" | "duplicate" | "error";

const WAITLIST_STATUS_PARAM = "waitlist_status";
const WAITLIST_EMAIL_PARAM = "waitlist_email";
const FLASH_PARAM = "flash";
const SIGNUP_STATUS_PARAM = "signup_status";

function extractString(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function redirectToLanding(
  request: NextRequest,
  status: WaitlistStatus,
  email: string | undefined,
  utms: CampaignParams,
) {
  const redirectUrl = new URL("/", request.url);
  redirectUrl.searchParams.set(WAITLIST_STATUS_PARAM, status);

  if (email) {
    redirectUrl.searchParams.set(WAITLIST_EMAIL_PARAM, email);
  }

  for (const key of CAMPAIGN_PARAM_KEYS) {
    const value = utms[key];
    if (value) {
      redirectUrl.searchParams.set(key, value);
    }
  }

  return NextResponse.redirect(redirectUrl, {
    status: 303,
  });
}

function redirectToOnboarding(
  request: NextRequest,
  flash: "waitlist-welcome" | "waitlist-existing",
  utms: CampaignParams,
) {
  const redirectUrl = new URL("/portal/onboarding/start", request.url);
  redirectUrl.searchParams.set(FLASH_PARAM, flash);
  redirectUrl.searchParams.set(
    SIGNUP_STATUS_PARAM,
    flash === "waitlist-existing" ? "duplicate" : "created",
  );

  for (const key of CAMPAIGN_PARAM_KEYS) {
    const value = utms[key];
    if (value) {
      redirectUrl.searchParams.set(key, value);
    }
  }

  const response = NextResponse.redirect(redirectUrl, { status: 303 });

  response.cookies.set({
    name: PORTAL_SESSION_COOKIE,
    value: `onboarding-${randomUUID()}`,
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });

  return response;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const campaignParams: CampaignParams = {};
  for (const field of CAMPAIGN_PARAM_KEYS) {
    const value = extractString(formData.get(field));
    if (value) {
      campaignParams[field] = value;
    }
  }

  const email = extractString(formData.get("email"));
  if (!email) {
    return redirectToLanding(request, "invalid_email", undefined, campaignParams);
  }

  const payload = {
    email,
    ...campaignParams,
  };

  const waitlistUrl = new URL("/api/waitlist", request.url);

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(waitlistUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (error) {
    return redirectToLanding(request, "error", email, campaignParams);
  }

  if (upstreamResponse.status === 409) {
    return redirectToOnboarding(request, "waitlist-existing", campaignParams);
  }

  if (upstreamResponse.status === 400) {
    return redirectToLanding(request, "invalid_email", email, campaignParams);
  }

  if (!upstreamResponse.ok) {
    return redirectToLanding(request, "error", email, campaignParams);
  }

  return redirectToOnboarding(request, "waitlist-welcome", campaignParams);
}
