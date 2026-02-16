"use client";

import React, { useMemo, useState } from "react";

type ConsentToggleKey =
  | "shareCalendarSignals"
  | "allowPlannerAutonomy"
  | "retainAuditTrail";

type ConsentSelections = Record<ConsentToggleKey, boolean>;

type ConsentItem = {
  key: ConsentToggleKey;
  title: string;
  description: string;
  impact: string;
};

const CONSENT_ITEMS: ConsentItem[] = [
  {
    key: "shareCalendarSignals",
    title: "Share scheduling signals",
    description:
      "Allow Tyrum to read summaries of your calendar holds, cancellations, and travel windows.",
    impact:
      "Unlocks proactive conflict detection and lets the planner pre-stage reschedules without committing changes.",
  },
  {
    key: "allowPlannerAutonomy",
    title: "Approve autopilot guardrails",
    description:
      "Permit the planner to act autonomously when spend stays under the caps you set during onboarding.",
    impact:
      "Keeps urgent requests moving without manual approval while still escalating anything outside your limits.",
  },
  {
    key: "retainAuditTrail",
    title: "Retain consent audit trail",
    description:
      "Store an auditable history of each consent toggle for 180 days so we can prove enforcement.",
    impact:
      "Ensures every guardrail decision is reportable to compliance reviewers and ready for export on request.",
  },
];

const INITIAL_SELECTIONS: ConsentSelections = {
  shareCalendarSignals: false,
  allowPlannerAutonomy: false,
  retainAuditTrail: false,
};

type SubmissionSuccess = {
  auditReference: string;
  revision: number;
};

async function submitConsent(selections: ConsentSelections) {
  const response = await fetch("/api/onboarding/consent", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ selections }),
    cache: "no-store",
  });

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorMessage =
      typeof (payload as { message?: unknown } | null)?.message === "string"
        ? (payload as { message: string }).message
        : "Unable to persist consent selections. Try again.";
    throw new Error(errorMessage);
  }

  const { auditReference, revision } = (payload ?? {}) as Partial<SubmissionSuccess>;

  if (typeof auditReference !== "string" || typeof revision !== "number") {
    throw new Error("Consent service returned an unexpected response. Try again.");
  }

  return { auditReference, revision };
}

export default function ConsentChecklistPage() {
  const [selections, setSelections] = useState<ConsentSelections>(INITIAL_SELECTIONS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SubmissionSuccess | null>(null);

  const completedToggleCount = useMemo(
    () => Object.values(selections).filter(Boolean).length,
    [selections],
  );

  const handleToggleChange = (key: ConsentToggleKey, value: boolean) => {
    setSelections((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleSubmit = async () => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await submitConsent(selections);
      setSuccess(result);
    } catch (submissionError) {
      setSuccess(null);
      setError(
        submissionError instanceof Error && submissionError.message
          ? submissionError.message
          : "Unable to persist consent selections. Try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="portal-onboarding" aria-labelledby="consent-checklist-heading">
      <header className="portal-onboarding__header">
        <div>
          <p className="portal-onboarding__eyebrow">Portal</p>
          <h1 id="consent-checklist-heading">Consent Checklist</h1>
        </div>
        <p className="portal-onboarding__lead">
          Review the guardrails Tyrum needs before we issue your session placeholder. Toggle the
          approvals you&apos;re comfortable with so we can calibrate autonomy from the first plan.
        </p>
      </header>

      <nav
        aria-label="Onboarding progress"
        className="portal-onboarding__progress"
      >
        <ol className="portal-onboarding__stepper">
          <li
            className="portal-onboarding__stepper-item portal-onboarding__stepper-item--current"
            aria-current="step"
          >
            <span className="portal-onboarding__stepper-index">1</span>
            <span className="portal-onboarding__stepper-label">Consent checklist</span>
          </li>
          <li className="portal-onboarding__stepper-item portal-onboarding__stepper-item--pending">
            <span className="portal-onboarding__stepper-index">2</span>
            <span className="portal-onboarding__stepper-label">Watcher defaults</span>
          </li>
          <li className="portal-onboarding__stepper-item portal-onboarding__stepper-item--pending">
            <span className="portal-onboarding__stepper-index">3</span>
            <span className="portal-onboarding__stepper-label">First outcomes</span>
          </li>
        </ol>
      </nav>

      <section
        className="portal-onboarding__content portal-onboarding__consent"
        aria-label="Guardrail approvals"
      >
        <header className="portal-onboarding__consent-header">
          <div>
            <h2>Lock in planner guardrails</h2>
            <p>
              Your selections help Tyrum honour consent defaults until we wire the full verification
              service. We recommend enabling all three toggles before continuing.
            </p>
          </div>
          <dl aria-label="Consent progress summary" className="portal-onboarding__consent-summary">
            <div>
              <dt>Selected</dt>
              <dd>{completedToggleCount} / 3</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{isSubmitting ? "Saving…" : success ? "Recorded" : "Draft"}</dd>
            </div>
          </dl>
        </header>

        <ul className="portal-onboarding__consent-list">
          {CONSENT_ITEMS.map((item) => {
            const checked = selections[item.key];
            const descriptionId = `${item.key}-description`;
            const impactId = `${item.key}-impact`;
            return (
              <li className="portal-onboarding__consent-item" key={item.key}>
                <article className="portal-onboarding__consent-card">
                  <header>
                    <h3>{item.title}</h3>
                    <p id={descriptionId}>{item.description}</p>
                  </header>
                  <p id={impactId} className="portal-onboarding__consent-impact">
                    {item.impact}
                  </p>
                  <label
                    className="portal-linking__toggle portal-onboarding__consent-toggle"
                    htmlFor={`consent-toggle-${item.key}`}
                  >
                    <input
                      id={`consent-toggle-${item.key}`}
                      type="checkbox"
                      className="portal-linking__checkbox"
                      checked={checked}
                      disabled={isSubmitting}
                      aria-describedby={`${descriptionId} ${impactId}`}
                      onChange={(event) =>
                        handleToggleChange(item.key, event.currentTarget.checked)
                      }
                    />
                    <span className="portal-linking__toggle-track" aria-hidden="true">
                      <span className="portal-linking__toggle-thumb" />
                    </span>
                    <span className="portal-linking__toggle-text">
                      {checked ? "Enabled" : "Enable"}
                    </span>
                  </label>
                </article>
              </li>
            );
          })}
        </ul>
        {error ? (
          <p
            className="portal-onboarding__consent-message portal-onboarding__consent-message--error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {success ? (
          <p
            className="portal-onboarding__consent-message portal-onboarding__consent-message--success"
            role="status"
          >
            Consent recorded as {success.auditReference} (revision {success.revision}). This stub
            stores selections in memory only until the consent service ships.
          </p>
        ) : null}

        <button
          type="button"
          className="portal-onboarding__consent-submit"
          onClick={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Saving consent…" : "Record consent selections"}
        </button>
      </section>

      <section className="portal-onboarding__next">
        <h2>What happens after consent</h2>
        <p>
          We&apos;ll light up watcher defaults next so you can confirm how Tyrum monitors spend,
          privacy, and escalation triggers. Once the verification stub is complete, these toggles
          will sync to the policy gate and issue your portal session.
        </p>
      </section>
    </main>
  );
}
