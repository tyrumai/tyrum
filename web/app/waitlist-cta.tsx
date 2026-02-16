"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { trackAnalytics } from "./lib/analytics";
import {
  extractCampaignParams,
  type CampaignParams,
} from "./lib/campaign";

type SubmissionState = "idle" | "loading" | "error";
type WaitlistStatus = "duplicate" | "invalid_email" | "error";

const INITIAL_MESSAGE = "Join the waitlist";
const DUPLICATE_MESSAGE = "You're already on the waitlist. Thanks for your trust.";
const GENERAL_ERROR_MESSAGE = "We couldn't save that email. Try again in a moment.";
const INVALID_EMAIL_MESSAGE = "That doesn't look like a valid email. Please try again.";

const WAITLIST_STATUS_PARAM = "waitlist_status";
const WAITLIST_EMAIL_PARAM = "waitlist_email";

function buildAnalyticsPayload(status: string, params: CampaignParams) {
  return Object.fromEntries(
    Object.entries({ status, ...params }).filter(
      ([, value]) => typeof value === "string" && value.trim().length > 0,
    ),
  ) as Record<string, string>;
}

function parseWaitlistStatus(value: string | null): WaitlistStatus | null {
  if (!value) {
    return null;
  }

  if (value === "duplicate" || value === "invalid_email" || value === "error") {
    return value;
  }

  return null;
}

function messageForStatus(status: WaitlistStatus): string {
  if (status === "duplicate") {
    return DUPLICATE_MESSAGE;
  }

  if (status === "invalid_email") {
    return INVALID_EMAIL_MESSAGE;
  }

  return GENERAL_ERROR_MESSAGE;
}

function analyticsStatusFor(status: WaitlistStatus): string {
  if (status === "duplicate") {
    return "duplicate";
  }
  if (status === "invalid_email") {
    return "invalid";
  }
  return "error";
}

export default function WaitlistCta() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SubmissionState>("idle");
  const [message, setMessage] = useState(INITIAL_MESSAGE);
  const [campaignParams, setCampaignParams] = useState<CampaignParams>({});

  // Mount-only: read URL params after hydration to avoid SSR mismatch.
  /* eslint-disable react-hooks/set-state-in-effect -- hydration-safe browser-state init */
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const campaigns = extractCampaignParams(params);
    setCampaignParams(campaigns);

    const status = parseWaitlistStatus(params.get(WAITLIST_STATUS_PARAM));
    const initialEmail = params.get(WAITLIST_EMAIL_PARAM);

    if (typeof initialEmail === "string" && initialEmail.trim().length > 0) {
      setEmail(initialEmail);
    }

    if (status) {
      setState("error");
      setMessage(messageForStatus(status));
      trackAnalytics(
        "waitlist_signup",
        buildAnalyticsPayload(analyticsStatusFor(status), campaigns),
      );
    } else {
      setState("idle");
      setMessage(INITIAL_MESSAGE);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const isDisabled = state === "loading";

  const buttonLabel = useMemo(() => {
    if (state === "loading") {
      return "Saving...";
    }

    return INITIAL_MESSAGE;
  }, [state]);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      const form = event.currentTarget;
      const emailField = form.elements.namedItem("email") as
        | HTMLInputElement
        | null;

      const trimmedEmail = email.trim();
      if (trimmedEmail.length === 0) {
        event.preventDefault();
        setState("error");
        setMessage(INVALID_EMAIL_MESSAGE);
        trackAnalytics(
          "waitlist_signup",
          buildAnalyticsPayload("invalid", campaignParams),
        );
        return;
      }

      if (emailField && emailField.value !== trimmedEmail) {
        emailField.value = trimmedEmail;
      }

      setEmail(trimmedEmail);
      setState("loading");
      setMessage("Adding you to the waitlist...");
    },
    [email, campaignParams],
  );

  return (
    <form
      className="waitlist-form"
      method="post"
      action="/portal/onboarding/entry"
      onSubmit={handleSubmit}
      noValidate
    >
      <label className="waitlist-form__label" htmlFor="waitlist-email">
        Email address
      </label>
      <div className="waitlist-form__controls">
        <input
          id="waitlist-email"
          className="waitlist-form__input"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={isDisabled}
          required
        />
        <button
          className="cta cta--primary waitlist-form__submit"
          type="submit"
          disabled={isDisabled}
        >
          {buttonLabel}
        </button>
      </div>
      {Object.entries(campaignParams).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <p
        className={`waitlist-form__message waitlist-form__message--${state}`}
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
    </form>
  );
}
