"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { trackAnalytics } from "./lib/analytics";

type CampaignParams = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
};

type SubmissionState = "idle" | "loading" | "success" | "error";

function buildAnalyticsPayload(status: string, params: CampaignParams) {
  return Object.fromEntries(
    Object.entries({ status, ...params }).filter(
      ([, value]) => typeof value === "string" && value.trim().length > 0,
    ),
  ) as Record<string, string>;
}

const INITIAL_MESSAGE = "Join the waitlist";
const SUCCESS_MESSAGE = "You're on the list. We'll keep you posted.";
const DUPLICATE_MESSAGE = "You're already on the waitlist. Thanks for your trust.";
const GENERAL_ERROR_MESSAGE = "We couldn't save that email. Try again in a moment.";
const INVALID_EMAIL_MESSAGE = "That doesn't look like a valid email. Please try again.";

function extractUtms(search: string): CampaignParams {
  const params = new URLSearchParams(search);
  const utms: CampaignParams = {};

  const maybeSet = (key: keyof CampaignParams) => {
    const value = params.get(key);
    if (value && value.trim().length > 0) {
      utms[key] = value.trim();
    }
  };

  maybeSet("utm_source");
  maybeSet("utm_medium");
  maybeSet("utm_campaign");
  maybeSet("utm_term");
  maybeSet("utm_content");

  return utms;
}

export default function WaitlistCta() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SubmissionState>("idle");
  const [message, setMessage] = useState(INITIAL_MESSAGE);
  const [campaignParams, setCampaignParams] = useState<CampaignParams>({});

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setCampaignParams(extractUtms(window.location.search));
  }, []);

  const isDisabled = state === "loading" || state === "success";

  const buttonLabel = useMemo(() => {
    if (state === "loading") {
      return "Saving...";
    }
    if (state === "success") {
      return "On the list";
    }
    return INITIAL_MESSAGE;
  }, [state]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const trimmedEmail = email.trim();
      if (trimmedEmail.length === 0) {
        setState("error");
        setMessage(INVALID_EMAIL_MESSAGE);
        return;
      }

      setState("loading");
      setMessage("Adding you to the waitlist...");

      const payload = {
        email: trimmedEmail,
        ...campaignParams,
      };

      try {
        const response = await fetch("/api/waitlist", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        const data = await response.json();

        if (response.ok) {
          setState("success");
          setMessage(SUCCESS_MESSAGE);
          setEmail("");
          trackAnalytics("waitlist_signup", buildAnalyticsPayload("success", campaignParams));
          return;
        }

        if (response.status === 409) {
          setState("error");
          setMessage(DUPLICATE_MESSAGE);
          trackAnalytics("waitlist_signup", buildAnalyticsPayload("duplicate", campaignParams));
          return;
        }

        if (response.status === 400) {
          setState("error");
          setMessage(typeof data.message === "string" ? data.message : INVALID_EMAIL_MESSAGE);
          trackAnalytics("waitlist_signup", buildAnalyticsPayload("invalid", campaignParams));
          return;
        }

        setState("error");
        setMessage(typeof data.message === "string" ? data.message : GENERAL_ERROR_MESSAGE);
        trackAnalytics("waitlist_signup", buildAnalyticsPayload("error", campaignParams));
      } catch (error) {
        setState("error");
        setMessage(GENERAL_ERROR_MESSAGE);
        trackAnalytics("waitlist_signup", buildAnalyticsPayload("network_error", campaignParams));
      }
    },
    [email, campaignParams],
  );

  return (
    <form className="waitlist-form" onSubmit={handleSubmit}>
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
          disabled={state === "loading"}
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
