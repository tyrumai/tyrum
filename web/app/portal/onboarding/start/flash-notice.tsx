"use client";

import React, { useEffect } from "react";
import { trackAnalytics } from "../../../lib/analytics";
import type { CampaignParams } from "../../../lib/campaign";

type FlashTone = "info" | "success";

type AnalyticsConfig = {
  status: string;
  campaign: CampaignParams;
};

type FlashNoticeProps = {
  message: string;
  tone: FlashTone;
  analytics?: AnalyticsConfig;
};

export default function FlashNotice({
  message,
  tone,
  analytics,
}: FlashNoticeProps) {
  useEffect(() => {
    if (!analytics) {
      return;
    }

    trackAnalytics(
      "waitlist_signup",
      Object.assign({ status: analytics.status }, analytics.campaign),
    );
  }, [analytics]);

  return (
    <p
      className={`portal-onboarding__flash portal-onboarding__flash--${tone}`}
      role="status"
    >
      {message}
    </p>
  );
}
