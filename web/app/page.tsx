import React from "react";
import type { UnsafeUnwrappedSearchParams } from "next/server";
import WaitlistCta from "./waitlist-cta";
import {
  CTA_FROM_PARAM,
  CTA_REDIRECT_PARAM,
  CTA_REDIRECT_REASON,
} from "./lib/portal-auth";

const valueProps = [
  {
    title: "Wallet limits respected",
    copy:
      "Freeze spend ceilings once and let Tyrum enforce them with audit logs you can replay.",
  },
  {
    title: "Explainable actions",
    copy:
      "Every step is justified before and after execution so you can approve with confidence.",
  },
  {
    title: "Privacy by default",
    copy: "Data stays within your workspace boundary and redacts sensitive fields by design.",
  },
];

const trustSignals = [
  "Wallet limits",
  "Explainable actions",
  "Privacy by default",
];

type SearchParamRecord = Record<string, string | string[] | undefined>;

type HomeProps = {
  searchParams?: Promise<SearchParamRecord>;
};

function unwrapSearchParams(
  searchParams: HomeProps["searchParams"],
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

export default function Home({ searchParams }: HomeProps) {
  const params = unwrapSearchParams(searchParams);
  const redirectReason = extractParamValue(params[CTA_REDIRECT_PARAM]);
  const redirectedFromRaw = extractParamValue(params[CTA_FROM_PARAM]);
  const redirectedFrom =
    redirectedFromRaw && redirectedFromRaw.startsWith("/")
      ? redirectedFromRaw
      : undefined;
  const showPortalRedirect = redirectReason === CTA_REDIRECT_REASON;

  return (
    <main className="landing" aria-labelledby="hero-heading">
      <section className="hero">
        <div className="hero__content">
          <p className="hero__eyebrow">Autonomy within your limits</p>
          <h1 id="hero-heading">The end of to-do.</h1>
          <p className="hero__deck">
            No lists. Just outcomes—captured, handled, and proven.
          </p>
          {showPortalRedirect ? (
            <p className="hero__notice" role="status" aria-live="polite">
              {redirectedFrom ? (
                <>
                  Access to <span className="hero__notice-path">{redirectedFrom}</span> requires an
                  active session. Complete onboarding below to continue.
                </>
              ) : (
                <>Portal access requires an active session. Complete onboarding below to continue.</>
              )}
            </p>
          ) : null}
          <div className="hero__cta">
            <WaitlistCta />
            <a className="cta cta--secondary" href="#value-props">
              See how it works
            </a>
          </div>
          <ul className="trust-row" aria-label="Proof points">
            {trustSignals.map((label) => (
              <li className="trust-row__item" key={label}>
                <span aria-hidden="true" className="trust-row__icon" />
                <span className="trust-row__label">{label}</span>
              </li>
            ))}
          </ul>
          <p className="hero__pronunciation">Tyrum is pronounced TIE-rum.</p>
        </div>
        <div className="hero__preview" aria-hidden="true">
          <div className="preview-card">
            <span className="preview-card__status">Quietly on it</span>
            <h2 className="preview-card__title">Handle the visa renewal</h2>
            <p className="preview-card__body">
              Planner coordinating a legal concierge, calendar holds, and spend caps within policy guardrails.
            </p>
            <div className="preview-card__tasks">
              <span className="preview-pill">Policy gate ✓</span>
              <span className="preview-pill">Executor queued</span>
              <span className="preview-pill">Audit streaming</span>
            </div>
          </div>
        </div>
      </section>
      <section
        aria-labelledby="value-props-heading"
        className="value-props"
        id="value-props"
      >
        <h2 className="visually-hidden" id="value-props-heading">
          Value propositions
        </h2>
        <ul className="value-props__list">
          {valueProps.map(({ title, copy }) => (
            <li className="value-props__item" key={title}>
              <h3>{title}</h3>
              <p>{copy}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
