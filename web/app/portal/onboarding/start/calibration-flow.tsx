"use client";

import React, { useEffect, useMemo, useReducer } from "react";
import Link from "next/link";
import type { ConsentSelections } from "../../../api/onboarding/consent/store";
import {
  CALIBRATION_DURATION_SECONDS,
  CALIBRATION_STEP_IDS,
  calibrationReducer,
  canAdvanceFromCurrentStep,
  createInitialCalibrationState,
  hasCompletedAllPersonaFields,
  isPersonaStep,
  remainingSeconds,
} from "./calibration.machine";
import type {
  CalibrationStepId,
  CalibrationState,
  PersonaSelections,
  PersonaStepId,
} from "./calibration.machine";

const CONSENT_TOGGLES: Array<{
  key: keyof ConsentSelections;
  title: string;
  description: string;
}> = [
  {
    key: "shareCalendarSignals",
    title: "Share scheduling signals",
    description:
      "Allow Tyrum to read summaries of your holds, cancellations, and travel windows so we can pre-stage reschedules.",
  },
  {
    key: "allowPlannerAutonomy",
    title: "Approve autopilot guardrails",
    description:
      "Permit Tyrum to act within the limits you confirm here so urgent requests keep moving without manual approval.",
  },
  {
    key: "retainAuditTrail",
    title: "Retain the audit trail",
    description:
      "Store a 180-day record of each consent change to keep compliance reviewers unblocked and exports deterministic.",
  },
];

type PersonaOption = {
  value: string;
  label: string;
  helper?: string;
};

type PersonaPrompt = {
  id: PersonaStepId;
  title: string;
  description: string;
  options: PersonaOption[];
};

const PERSONA_PROMPTS: PersonaPrompt[] = [
  {
    id: "tone",
    title: "Tone",
    description: "Pick the baseline energy Tyrum uses when drafting voice replies.",
    options: [
      { value: "upbeat", label: "Upbeat", helper: "Warm, optimistic, and proactive." },
      { value: "neutral", label: "Neutral", helper: "Even cadence with minimal flourishes." },
      { value: "formal", label: "Formal", helper: "Structured, precise, and audit-friendly." },
    ],
  },
  {
    id: "verbosity",
    title: "Verbosity",
    description: "Control how much detail Tyrum delivers by default.",
    options: [
      { value: "terse", label: "Crisp", helper: "Bulleted highlights only." },
      { value: "balanced", label: "Balanced", helper: "Summary plus key evidence." },
      { value: "thorough", label: "Thorough", helper: "Full context with references." },
    ],
  },
  {
    id: "initiative",
    title: "Initiative",
    description: "Decide how quickly Tyrum should act once a plan is ready.",
    options: [
      { value: "ask_first", label: "Ask every time", helper: "Always request confirmation." },
      { value: "ask_once_per_vendor", label: "Ask once per vendor", helper: "Remember approvals by counterpart." },
      {
        value: "act_within_limits",
        label: "Act within limits",
        helper: "Proceed immediately when spend stays under your caps.",
      },
    ],
  },
  {
    id: "quietHours",
    title: "Quiet hours",
    description: "Tell Tyrum when to pause non-urgent messages.",
    options: [
      { value: "21-07", label: "21:00 – 07:00", helper: "Evening and overnight focus blocks." },
      { value: "22-06", label: "22:00 – 06:00", helper: "Late night guardrails." },
      { value: "none", label: "No quiet hours", helper: "Reach out whenever something happens." },
    ],
  },
  {
    id: "spending",
    title: "Spending",
    description: "Set the ceiling for autonomous, everyday approvals.",
    options: [
      { value: "25", label: "Up to €25", helper: "Coffee runs, local rides, and takeout." },
      { value: "50", label: "Up to €50", helper: "Most daily purchases and renewals." },
      { value: "manual", label: "Always ask", helper: "Keep approvals manual regardless of amount." },
    ],
  },
  {
    id: "voice",
    title: "Voice sample",
    description: "Choose the delivery you prefer for voice notes and TTS.",
    options: [
      { value: "bright", label: "Bright", helper: "Higher pace and upbeat cadence." },
      { value: "warm", label: "Warm", helper: "Measured pace with softer edges." },
      { value: "precise", label: "Precise", helper: "Neutral timbre prioritising enunciation." },
    ],
  },
];

function formatSeconds(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const clamped = safeSeconds > CALIBRATION_DURATION_SECONDS ? CALIBRATION_DURATION_SECONDS : safeSeconds;
  const minutes = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const remaining = Math.floor(clamped % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function getCurrentPrompt(stepId: PersonaStepId | undefined) {
  if (!stepId) {
    return null;
  }

  return PERSONA_PROMPTS.find((prompt) => prompt.id === stepId) ?? null;
}

function nextStepLabel(step: CalibrationStepId | undefined) {
  if (!step) {
    return "Next";
  }

  if (step === "consent") {
    return "Review selections";
  }

  return "Next prompt";
}

function buildSubmissionPayload(
  state: CalibrationState,
  now: number,
): {
  selections: ConsentSelections;
  calibration: {
    persona: PersonaSelections;
    startedAt: string;
    completedAt: string;
    durationSeconds: number;
  };
} {
  if (!state.startedAt) {
    throw new Error("Calibration has not started yet.");
  }

  const durationSeconds = Math.min(
    CALIBRATION_DURATION_SECONDS,
    Math.max(0, Math.floor((now - state.startedAt) / 1000)),
  );

  return {
    selections: state.consent,
    calibration: {
      persona: state.persona,
      startedAt: new Date(state.startedAt).toISOString(),
      completedAt: new Date(now).toISOString(),
      durationSeconds,
    },
  };
}

export default function CalibrationFlow() {
  const [state, dispatch] = useReducer(calibrationReducer, undefined, () =>
    createInitialCalibrationState(),
  );

  useEffect(() => {
    if (
      state.status !== "collecting" &&
      state.status !== "review" &&
      state.status !== "submitting"
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      dispatch({ type: "tick", now: Date.now() });
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [state.status]);

  const currentStepId = useMemo(() => {
    if (state.status !== "collecting") {
      return null;
    }

    return CALIBRATION_STEP_IDS[state.stepIndex] ?? null;
  }, [state.status, state.stepIndex]);

  const personaPrompt = useMemo(() => {
    if (!currentStepId || !isPersonaStep(currentStepId)) {
      return null;
    }

    return getCurrentPrompt(currentStepId);
  }, [currentStepId]);

  const countdown = formatSeconds(remainingSeconds(state));
  const progressLabel = state.status === "collecting"
    ? `Prompt ${state.stepIndex + 1} of ${CALIBRATION_STEP_IDS.length}`
    : state.status === "review"
      ? "Review"
      : state.status === "success"
        ? "Completed"
        : state.status === "expired"
          ? "Expired"
          : undefined;

  const showBackButton =
    (state.status === "collecting" && state.stepIndex > 0) || state.status === "review";

  const personaSummary = useMemo(() => {
    const entries = PERSONA_PROMPTS.map((prompt) => ({
      id: prompt.id,
      label: prompt.title,
      value: state.persona[prompt.id],
    }));

    return entries;
  }, [state.persona]);

  const handleStart = () => {
    dispatch({ type: "start", now: Date.now() });
  };

  const handlePersonaSelect = (step: PersonaStepId, value: string) => {
    dispatch({ type: "update_persona", step, value });
  };

  const handleConsentToggle = (key: keyof ConsentSelections) => {
    dispatch({ type: "set_consent", key, value: !state.consent[key] });
  };

  const handleAdvance = () => {
    dispatch({ type: "advance" });
  };

  const handleBack = () => {
    dispatch({ type: "back" });
  };

  const handleReset = () => {
    dispatch({ type: "reset" });
  };

  const handleSubmit = async () => {
    if (state.status !== "review") {
      return;
    }

    if (!state.startedAt) {
      dispatch({
        type: "submit_failure",
        message: "Calibration start time is missing. Restart and try again.",
      });
      return;
    }

    const now = Date.now();
    const payload = buildSubmissionPayload(state, now);

    dispatch({ type: "submit" });

    try {
      const response = await fetch("/api/onboarding/consent", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      });

      const json = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          typeof (json as { message?: unknown } | null)?.message === "string"
            ? (json as { message: string }).message
            : "Unable to store calibration yet. Try again.";
        dispatch({ type: "submit_failure", message });
        return;
      }

      const auditReference = (json as { auditReference?: unknown })?.auditReference;
      const revision = (json as { revision?: unknown })?.revision;

      if (typeof auditReference !== "string" || typeof revision !== "number") {
        dispatch({
          type: "submit_failure",
          message: "Consent service returned an unexpected response. Try again.",
        });
        return;
      }

      dispatch({
        type: "submit_success",
        submission: { auditReference, revision },
        completedAt: now,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Unable to reach the consent service. Try again.";
      dispatch({ type: "submit_failure", message });
    }
  };

  if (state.status === "idle") {
    return (
      <section className="portal-onboarding__content" aria-label="Voice calibration setup">
        <header className="portal-onboarding__calibration-header">
          <div>
            <h2>Voice calibration</h2>
            <p>
              Calibration runs for 90 seconds. Answer each prompt once and confirm the consent toggles so Tyrum can honour your voice defaults from the first session.
            </p>
          </div>
          <button
            type="button"
            className="portal-onboarding__cta"
            onClick={handleStart}
          >
            Start calibration
          </button>
        </header>
      </section>
    );
  }

  if (state.status === "expired") {
    return (
      <section className="portal-onboarding__content" aria-label="Calibration expired">
        <header className="portal-onboarding__calibration-header">
          <div>
            <h2>Calibration expired</h2>
            <p>
              The 90-second window elapsed before the prompts were confirmed. Restart to capture your persona and consent defaults.
            </p>
          </div>
          <button
            type="button"
            className="portal-onboarding__cta"
            onClick={handleReset}
          >
            Restart calibration
          </button>
        </header>
      </section>
    );
  }

  if (state.status === "success") {
    return (
      <section className="portal-onboarding__content" aria-label="Calibration complete">
        <header className="portal-onboarding__calibration-header">
          <div>
            <h2>Calibration recorded</h2>
            <p>
              Persona defaults and consent selections are stored as {state.submission?.auditReference}. Tyrum will carry these guardrails into the next onboarding steps.
            </p>
            <p className="portal-onboarding__calibration-meta">
              Duration: {formatSeconds(state.elapsedSeconds)} · Revision: {state.submission?.revision}
            </p>
          </div>
          <Link className="portal-onboarding__cta" href="/portal/onboarding/consent">
            Continue to consent checklist
          </Link>
        </header>
      </section>
    );
  }

  const isCollecting = state.status === "collecting";
  const isReview = state.status === "review" || state.status === "submitting";
  const disableNext =
    isCollecting && (!currentStepId || !canAdvanceFromCurrentStep(state));

  return (
    <section
      className="portal-onboarding__content portal-onboarding__calibration"
      aria-live="polite"
      aria-label="Calibration prompts"
    >
      <header className="portal-onboarding__calibration-header">
        <div>
          <h2>{isReview ? "Review calibration" : "Calibrate Tyrum"}</h2>
          <p>
            {isReview
              ? "Confirm your persona defaults and consent selections before we store them."
              : "Keep an eye on the countdown—answers lock once the timer expires."}
          </p>
          {progressLabel ? (
            <p className="portal-onboarding__calibration-progress">{progressLabel}</p>
          ) : null}
        </div>
        <div className="portal-onboarding__calibration-timer" aria-live="assertive">
          <span aria-label="Countdown">{countdown}</span>
        </div>
      </header>

      {isCollecting && personaPrompt ? (
        <article className="portal-onboarding__calibration-card">
          <header>
            <h3>{personaPrompt.title}</h3>
            <p>{personaPrompt.description}</p>
          </header>
          <div className="portal-onboarding__calibration-options">
            {personaPrompt.options.map((option) => {
              const checked = state.persona[personaPrompt.id] === option.value;
              const optionId = `${personaPrompt.id}-${option.value}`;
              return (
                <label key={option.value} htmlFor={optionId} className="portal-onboarding__option">
                  <input
                    id={optionId}
                    type="radio"
                    name={personaPrompt.id}
                    value={option.value}
                    checked={checked}
                    onChange={() => handlePersonaSelect(personaPrompt.id, option.value)}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    {option.helper ? <small>{option.helper}</small> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </article>
      ) : null}

      {isCollecting && currentStepId === "consent" ? (
        <article className="portal-onboarding__calibration-card">
          <header>
            <h3>Consent toggles</h3>
            <p>Select the guardrails Tyrum should enforce from day one.</p>
          </header>
          <ul className="portal-onboarding__consent-preview">
            {CONSENT_TOGGLES.map((toggle) => {
              const toggleId = `calibration-consent-${toggle.key}`;
              return (
                <li key={toggle.key}>
                  <label htmlFor={toggleId} className="portal-linking__toggle">
                    <input
                      id={toggleId}
                      type="checkbox"
                      className="portal-linking__checkbox"
                      checked={state.consent[toggle.key]}
                      onChange={() => handleConsentToggle(toggle.key)}
                    />
                    <span className="portal-linking__toggle-track" aria-hidden="true">
                      <span className="portal-linking__toggle-thumb" />
                    </span>
                    <span className="portal-linking__toggle-text">
                      <strong>{toggle.title}</strong>
                      <small>{toggle.description}</small>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </article>
      ) : null}

      {isReview ? (
        <article className="portal-onboarding__calibration-card">
          <header>
            <h3>Summary</h3>
            <p>Verify persona defaults and ensure at least one consent toggle stays active.</p>
          </header>
          <dl className="portal-onboarding__calibration-summary">
            {personaSummary.map((entry) => (
              <div key={entry.id}>
                <dt>{entry.label}</dt>
                <dd>{entry.value ?? "Not set"}</dd>
              </div>
            ))}
            <div>
              <dt>Consent toggles</dt>
              <dd>
                {Object.entries(state.consent)
                  .filter(([, enabled]) => enabled)
                  .map(([key]) => CONSENT_TOGGLES.find((toggle) => toggle.key === key)?.title)
                  .filter(Boolean)
                  .join(", ") || "None enabled"}
              </dd>
            </div>
          </dl>
          {state.error ? (
            <p className="portal-onboarding__calibration-error" role="alert">
              {state.error}
            </p>
          ) : null}
        </article>
      ) : null}

      <footer className="portal-onboarding__calibration-actions">
        {showBackButton ? (
          <button type="button" className="portal-onboarding__cta-secondary" onClick={handleBack}>
            Back
          </button>
        ) : null}

        {isCollecting ? (
          <button
            type="button"
            className="portal-onboarding__cta"
            onClick={handleAdvance}
            disabled={disableNext}
          >
            {nextStepLabel(currentStepId ?? undefined)}
          </button>
        ) : null}

        {state.status === "review" ? (
          <button
            type="button"
            className="portal-onboarding__cta"
            onClick={handleSubmit}
            disabled={!hasCompletedAllPersonaFields(state)}
          >
            Record calibration
          </button>
        ) : null}

        {state.status === "submitting" ? (
          <button type="button" className="portal-onboarding__cta" disabled>
            Recording…
          </button>
        ) : null}
      </footer>
    </section>
  );
}
