import { NextResponse } from "next/server";
import { snapshotConsent } from "../consent/store";
import {
  PORTAL_SESSION_COOKIE,
  PORTAL_SESSION_MAX_AGE_SECONDS,
  computePortalSessionTokenFromSecret,
  requirePortalSessionSecret,
} from "../../../lib/portal-auth";

type VerificationResponse =
  | {
      status: "verified";
      token: string;
      expiresAt: string;
      revision: number;
      auditReference: string;
    }
  | {
      error: string;
      message: string;
    };

function buildExpiresAt() {
  const expiresAt = new Date(
    Date.now() + PORTAL_SESSION_MAX_AGE_SECONDS * 1000,
  );

  return expiresAt.toISOString();
}

export async function POST() {
  const consent = snapshotConsent();

  if (consent.revision === 0) {
    return NextResponse.json<VerificationResponse>(
      {
        error: "consent_not_recorded",
        message:
          "Consent selections must be captured before the portal session can be verified.",
      },
      { status: 409 },
    );
  }

  let secret: string;
  try {
    secret = requirePortalSessionSecret();
  } catch (error) {
    return NextResponse.json<VerificationResponse>(
      {
        error: "configuration_error",
        message:
          error instanceof Error
            ? error.message
            : "Portal verification secret is missing.",
      },
      { status: 500 },
    );
  }

  const token = computePortalSessionTokenFromSecret(secret);
  const expiresAt = buildExpiresAt();

  const response = NextResponse.json<VerificationResponse>(
    {
      status: "verified",
      token,
      expiresAt,
      revision: consent.revision,
      auditReference: consent.auditReference,
    },
    { status: 200 },
  );

  response.cookies.set({
    name: PORTAL_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    path: "/",
    maxAge: PORTAL_SESSION_MAX_AGE_SECONDS,
  });

  return response;
}
