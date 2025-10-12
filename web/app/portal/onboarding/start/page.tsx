import React from "react";
import type { UnsafeUnwrappedSearchParams } from "next/server";
import FlashNotice from "./flash-notice";
import {
  CAMPAIGN_PARAM_KEYS,
  type CampaignParams,
} from "../../../lib/campaign";
import CalibrationFlow from "./calibration-flow";

const FLASH_PARAM = "flash";
const SIGNUP_STATUS_PARAM = "signup_status";

const FLASH_CONFIG = {
  "waitlist-welcome": {
    message: "You're on the list. Let's calibrate Tyrum to your voice.",
    tone: "success" as const,
    analyticsStatus: "success",
  },
  "waitlist-existing": {
    message: "Welcome back—your waitlist spot is active. Resume onboarding below.",
    tone: "info" as const,
    analyticsStatus: "duplicate",
  },
};

type SearchParamRecord = Record<string, string | string[] | undefined>;

type OnboardingStartProps = {
  searchParams?: Promise<SearchParamRecord>;
};

function unwrapSearchParams(
  searchParams: OnboardingStartProps["searchParams"],
): SearchParamRecord {
  if (!searchParams) {
    return {};
  }

  if (typeof (searchParams as { then?: unknown }).then !== "function") {
    return searchParams as unknown as SearchParamRecord;
  }

  return searchParams as unknown as UnsafeUnwrappedSearchParams<
    Promise<SearchParamRecord>
  >;
}

function extractParamValue(
  value: string | string[] | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value[0] : value;
}

function extractCampaignFromRecord(
  params: SearchParamRecord,
): CampaignParams {
  const campaign: CampaignParams = {};

  for (const key of CAMPAIGN_PARAM_KEYS) {
    const value = extractParamValue(params[key]);
    if (value) {
      campaign[key] = value;
    }
  }

  return campaign;
}

export default function OnboardingStart({
  searchParams,
}: OnboardingStartProps) {
  const params = unwrapSearchParams(searchParams);
  const flashKey = extractParamValue(params[FLASH_PARAM]);
  const signupStatus = extractParamValue(params[SIGNUP_STATUS_PARAM]);
  const campaign = extractCampaignFromRecord(params);

  const flashConfig = flashKey ? FLASH_CONFIG[flashKey as keyof typeof FLASH_CONFIG] : undefined;

  const analytics =
    flashConfig && (signupStatus ?? flashConfig.analyticsStatus)
      ? {
          status: signupStatus ?? flashConfig.analyticsStatus,
          campaign,
        }
      : undefined;

  return (
    <main className="portal-onboarding" aria-labelledby="onboarding-heading">
      <header className="portal-onboarding__header">
        <div>
          <p className="portal-onboarding__eyebrow">Portal</p>
          <h1 id="onboarding-heading">Onboarding Start</h1>
        </div>
        <p className="portal-onboarding__lead">
          Kick off Tyrum&apos;s calibration so the planner delivers outcomes within your limits.
        </p>
        {flashConfig ? (
          <FlashNotice
            message={flashConfig.message}
            tone={flashConfig.tone}
            analytics={analytics}
          />
        ) : null}
      </header>
      <CalibrationFlow />
      <section className="portal-onboarding__next">
        <h2>What happens next</h2>
        <p>
          Once calibration is recorded we&apos;ll surface watcher defaults (ONB-02) so you can review
          spend, privacy, and escalation observers before the planner issues your first preview.
        </p>
      </section>
    </main>
  );
}
