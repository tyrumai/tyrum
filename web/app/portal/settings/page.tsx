"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

type AuditTaskResponse = {
  status?: string;
  task?: {
    id?: string;
    type?: string;
    auditReference?: string;
    etaSeconds?: number;
  };
  message?: string;
};

type ToastTone = "info" | "success" | "error";

type ToastState = {
  id: number;
  message: string;
  tone: ToastTone;
};

type AccountAction = "export" | "delete";

const TOAST_TIMEOUT_MS = 4000;

type PamFormState = {
  escalationMode: string;
  limitMinorUnits: string;
  currency: string;
};

type PvpFormState = {
  tone: string;
  verbosity: string;
  initiative: string;
  consentStyle: string;
  emojiGifs: string;
  language: string;
  voiceId: string;
  pace: string;
  pitch: string;
  warmth: string;
};

type ProfilesEnvelope = {
  pam?: {
    profile_id: string;
    version: string;
    profile: unknown;
  } | null;
  pvp?: {
    profile_id: string;
    version: string;
    profile: unknown;
  } | null;
};

const DEFAULT_PAM_FORM: PamFormState = {
  escalationMode: "",
  limitMinorUnits: "",
  currency: "",
};

const DEFAULT_PVP_FORM: PvpFormState = {
  tone: "",
  verbosity: "",
  initiative: "",
  consentStyle: "",
  emojiGifs: "",
  language: "",
  voiceId: "",
  pace: "",
  pitch: "",
  warmth: "",
};

const PAM_ESCALATION_OPTIONS = [
  "ask_first",
  "ask_once_per_vendor",
  "act_within_limits",
];

const PVP_TONE_OPTIONS = ["calm", "energetic", "witty", "formal", "playful"];
const PVP_VERBOSITY_OPTIONS = ["terse", "balanced", "thorough"];
const PVP_INITIATIVE_OPTIONS = ["low", "medium", "high"];
const PVP_CONSENT_OPTIONS = [
  "ask_first",
  "ask_once_per_vendor",
  "act_within_limits",
];
const PVP_EMOJI_OPTIONS = ["never", "sometimes", "often"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const humanizeOption = (value: string) =>
  value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const ACTION_COPY: Record<
  AccountAction,
  {
    heading: string;
    body: string;
    cta: string;
    success: string;
    inFlight: string;
    error: string;
  }
> = {
  export: {
    heading: "Export your data",
    body:
      "Request a full export of the data Tyrum has collected. We will package the latest audit trail for review.",
    cta: "Queue export",
    success: "Data export enqueued. Audit reference __REF__.",
    inFlight: "Queuing your export…",
    error:
      "We could not queue the export right now. Try again in a few minutes or contact support.",
  },
  delete: {
    heading: "Delete your account",
    body:
      "Schedule an account deletion. The execution team will confirm consent before wiping associated data.",
    cta: "Queue deletion",
    success: "Account deletion scheduled. Audit reference __REF__.",
    inFlight: "Submitting your deletion request…",
    error:
      "We could not schedule the deletion. Try again shortly or contact support for manual handling.",
  },
};

async function parseJsonResponse(response: Response) {
  const raw = await response.text();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return { message: raw };
  }
}

export default function AccountSettingsPage() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pendingAction, setPendingAction] = useState<AccountAction | null>(null);
  const [toastCounter, setToastCounter] = useState(0);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [pamForm, setPamForm] = useState<PamFormState>(DEFAULT_PAM_FORM);
  const [pamVersion, setPamVersion] = useState<string | null>(null);
  const [pvpForm, setPvpForm] = useState<PvpFormState>(DEFAULT_PVP_FORM);
  const [pvpVersion, setPvpVersion] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setToast(null), TOAST_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const raiseToast = useCallback((tone: ToastTone, message: string) => {
    if (!isMountedRef.current) {
      return;
    }

    setToastCounter((current) => {
      if (!isMountedRef.current) {
        return current;
      }

      const next = current + 1;
      setToast({ id: next, tone, message });
      return next;
    });
  }, []);

  const triggerAction = async (action: AccountAction) => {
    if (pendingAction) {
      return;
    }

    const config = ACTION_COPY[action];
    if (!isMountedRef.current) {
      return;
    }
    setPendingAction(action);
    raiseToast("info", config.inFlight);

    try {
      const response = await fetch(`/api/account/${action}`, {
        method: "POST",
        headers: {
          accept: "application/json",
        },
        cache: "no-store",
      });

      const payload = (await parseJsonResponse(response)) as AuditTaskResponse;
      if (!response.ok) {
        const message =
          typeof payload?.message === "string" ? payload.message : config.error;
        throw new Error(message);
      }

      if (isMountedRef.current) {
        const reference =
          payload?.task?.auditReference ?? payload?.task?.id ?? "AUDIT-REFERENCE";
        const successMessage = config.success.replace("__REF__", reference);
        raiseToast("success", successMessage);
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : config.error;
      if (isMountedRef.current) {
        raiseToast("error", message);
      }
    } finally {
      if (isMountedRef.current) {
        setPendingAction(null);
      }
    }
  };

  const handlePamSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedLimit = pamForm.limitMinorUnits.trim();
    let parsedLimit: number | undefined;
    if (trimmedLimit) {
      parsedLimit = Number(trimmedLimit);
      if (Number.isNaN(parsedLimit)) {
        raiseToast("error", "Auto-approve limit must be a number.");
        return;
      }
    }

    const profile: Record<string, unknown> = {};
    if (pamForm.escalationMode) {
      profile.escalation_mode = pamForm.escalationMode;
    }
    if (parsedLimit !== undefined || pamForm.currency.trim()) {
      const autoApprove: Record<string, unknown> = {};
      if (parsedLimit !== undefined) {
        autoApprove.limit_minor_units = parsedLimit;
      }
      if (pamForm.currency.trim()) {
        autoApprove.currency = pamForm.currency.trim();
      }
      profile.auto_approve = autoApprove;
    }

    try {
      const response = await fetch("/api/profiles/pam", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ profile, confidence: {} }),
        cache: "no-store",
      });

      const payload = (await parseJsonResponse(response)) as {
        profile?: unknown;
        version?: string;
        message?: string;
      };

      if (!response.ok) {
        const message =
          typeof payload?.message === "string"
            ? payload.message
            : "Unable to store autonomy preferences.";
        throw new Error(message);
      }

      if (!isMountedRef.current) {
        return;
      }

      const pamProfile = isRecord(payload.profile)
        ? (payload.profile as Record<string, unknown>)
        : undefined;
      const autoApprove = isRecord(pamProfile?.auto_approve)
        ? (pamProfile?.auto_approve as Record<string, unknown>)
        : undefined;

      setPamForm({
        escalationMode:
          typeof pamProfile?.escalation_mode === "string"
            ? pamProfile.escalation_mode
            : "",
        limitMinorUnits:
          typeof autoApprove?.limit_minor_units === "number"
            ? autoApprove.limit_minor_units.toString()
            : "",
        currency:
          typeof autoApprove?.currency === "string"
            ? autoApprove.currency
            : "",
      });
      setPamVersion(payload.version ?? null);
      raiseToast("success", "Autonomy preferences saved.");
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Unable to store autonomy preferences.";
      if (isMountedRef.current) {
        raiseToast("error", message);
      }
    }
  };

  const handlePvpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const numericFields: Array<[string, string]> = [
      ["pace", pvpForm.pace.trim()],
      ["pitch", pvpForm.pitch.trim()],
      ["warmth", pvpForm.warmth.trim()],
    ];

    const voice: Record<string, unknown> = {};
    for (const [key, value] of numericFields) {
      if (!value) {
        continue;
      }
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        raiseToast("error", `Voice ${key} must be a number.`);
        return;
      }
      voice[key] = parsed;
    }
    if (pvpForm.voiceId.trim()) {
      voice.voice_id = pvpForm.voiceId.trim();
    }

    const profile: Record<string, unknown> = {};
    if (pvpForm.tone) {
      profile.tone = pvpForm.tone;
    }
    if (pvpForm.verbosity) {
      profile.verbosity = pvpForm.verbosity;
    }
    if (pvpForm.initiative) {
      profile.initiative = pvpForm.initiative;
    }
    if (pvpForm.consentStyle) {
      profile.consent_style = pvpForm.consentStyle;
    }
    if (pvpForm.emojiGifs) {
      profile.emoji_gifs = pvpForm.emojiGifs;
    }
    if (pvpForm.language.trim()) {
      profile.language = pvpForm.language.trim();
    }
    if (Object.keys(voice).length > 0) {
      profile.voice = voice;
    }

    try {
      const response = await fetch("/api/profiles/pvp", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ profile }),
        cache: "no-store",
      });

      const payload = (await parseJsonResponse(response)) as {
        profile?: unknown;
        version?: string;
        message?: string;
      };

      if (!response.ok) {
        const message =
          typeof payload?.message === "string"
            ? payload.message
            : "Unable to store persona preferences.";
        throw new Error(message);
      }

      if (!isMountedRef.current) {
        return;
      }

      const pvpProfile = isRecord(payload.profile)
        ? (payload.profile as Record<string, unknown>)
        : undefined;
      const updatedVoice = isRecord(pvpProfile?.voice)
        ? (pvpProfile?.voice as Record<string, unknown>)
        : undefined;
      const numericToString = (value: unknown) =>
        typeof value === "number" ? value.toString() : "";

      setPvpForm({
        tone: typeof pvpProfile?.tone === "string" ? pvpProfile.tone : "",
        verbosity:
          typeof pvpProfile?.verbosity === "string" ? pvpProfile.verbosity : "",
        initiative:
          typeof pvpProfile?.initiative === "string" ? pvpProfile.initiative : "",
        consentStyle:
          typeof pvpProfile?.consent_style === "string"
            ? pvpProfile.consent_style
            : "",
        emojiGifs:
          typeof pvpProfile?.emoji_gifs === "string" ? pvpProfile.emoji_gifs : "",
        language:
          typeof pvpProfile?.language === "string" ? pvpProfile.language : "",
        voiceId: typeof updatedVoice?.voice_id === "string" ? updatedVoice.voice_id : "",
        pace: numericToString(updatedVoice?.pace),
        pitch: numericToString(updatedVoice?.pitch),
        warmth: numericToString(updatedVoice?.warmth),
      });
      setPvpVersion(payload.version ?? null);
      raiseToast("success", "Persona preferences saved.");
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Unable to store persona preferences.";
      if (isMountedRef.current) {
        raiseToast("error", message);
      }
    }
  };

  useEffect(() => {
    const loadProfiles = async () => {
      try {
        const response = await fetch("/api/profiles", {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });

        const payload = (await parseJsonResponse(response)) as
          | ProfilesEnvelope
          | { message?: string };

        if (!response.ok) {
          const message =
            typeof (payload as { message?: string })?.message === "string"
              ? (payload as { message?: string }).message
              : "Unable to load stored profiles.";
          throw new Error(message);
        }

        if (!isMountedRef.current) {
          return;
        }

        const pamProfile = isRecord(payload?.pam?.profile)
          ? (payload?.pam?.profile as Record<string, unknown>)
          : undefined;
        const pamAutoApprove = isRecord(pamProfile?.auto_approve)
          ? (pamProfile?.auto_approve as Record<string, unknown>)
          : undefined;

        setPamForm({
          escalationMode:
            typeof pamProfile?.escalation_mode === "string"
              ? pamProfile.escalation_mode
              : "",
          limitMinorUnits:
            typeof pamAutoApprove?.limit_minor_units === "number"
              ? pamAutoApprove.limit_minor_units.toString()
              : "",
          currency:
            typeof pamAutoApprove?.currency === "string"
              ? pamAutoApprove.currency
              : "",
        });
        setPamVersion(payload?.pam?.version ?? null);

        const pvpProfile = isRecord(payload?.pvp?.profile)
          ? (payload?.pvp?.profile as Record<string, unknown>)
          : undefined;
        const voice = isRecord(pvpProfile?.voice)
          ? (pvpProfile?.voice as Record<string, unknown>)
          : undefined;

        const numericToString = (value: unknown) =>
          typeof value === "number" ? value.toString() : "";

        setPvpForm({
          tone: typeof pvpProfile?.tone === "string" ? pvpProfile.tone : "",
          verbosity:
            typeof pvpProfile?.verbosity === "string" ? pvpProfile.verbosity : "",
          initiative:
            typeof pvpProfile?.initiative === "string" ? pvpProfile.initiative : "",
          consentStyle:
            typeof pvpProfile?.consent_style === "string"
              ? pvpProfile.consent_style
              : "",
          emojiGifs:
            typeof pvpProfile?.emoji_gifs === "string" ? pvpProfile.emoji_gifs : "",
          language:
            typeof pvpProfile?.language === "string" ? pvpProfile.language : "",
          voiceId: typeof voice?.voice_id === "string" ? voice.voice_id : "",
          pace: numericToString(voice?.pace),
          pitch: numericToString(voice?.pitch),
          warmth: numericToString(voice?.warmth),
        });
        setPvpVersion(payload?.pvp?.version ?? null);
      } catch (error) {
        if (isMountedRef.current) {
          const message =
            error instanceof Error && error.message
              ? error.message
              : "Unable to load stored profiles.";
          raiseToast("error", message);
        }
      } finally {
        if (isMountedRef.current) {
          setProfilesLoading(false);
        }
      }
    };

    loadProfiles();
  }, [raiseToast]);

  return (
    <main className="portal-settings" aria-labelledby="settings-heading">
      <header className="portal-settings__header">
        <div>
          <p className="portal-settings__eyebrow">Portal</p>
          <h1 id="settings-heading">Account Settings</h1>
        </div>
        <p className="portal-settings__lead">
          Control the account lifecycle for your Tyrum workspace. Export archives help you
          verify that our automation respects consent before requesting deletion.
        </p>
      </header>

      {toast ? (
        <p
          key={toast.id}
          className={`portal-settings__toast portal-settings__toast--${toast.tone}`}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          {toast.message}
        </p>
      ) : null}

      <section className="portal-settings__actions" aria-label="Account lifecycle actions">
        {(["export", "delete"] as AccountAction[]).map((action) => {
          const config = ACTION_COPY[action];
          const loading = pendingAction === action;

          return (
            <article className="portal-settings__card" key={action}>
              <header className="portal-settings__card-header">
                <h2>{config.heading}</h2>
                <p>{config.body}</p>
              </header>
              <footer className="portal-settings__card-footer">
                <button
                  type="button"
                  className="portal-settings__button"
                  onClick={() => triggerAction(action)}
                  disabled={Boolean(pendingAction)}
                >
                  {loading ? "Processing…" : config.cta}
                </button>
              </footer>
            </article>
          );
        })}
      </section>

      <section className="portal-settings__actions" aria-label="Profile preferences">
        <article className="portal-settings__card">
          <header className="portal-settings__card-header">
            <h2>Autonomy preferences</h2>
            <p>Configure how Tyrum acts on your behalf for everyday automation.</p>
          </header>
          <form className="portal-settings__form" onSubmit={handlePamSubmit}>
            <div className="portal-settings__field">
              <label htmlFor="pam-escalation">Escalation mode</label>
              <select
                id="pam-escalation"
                value={pamForm.escalationMode}
                onChange={(event) =>
                  setPamForm((current) => ({
                    ...current,
                    escalationMode: event.target.value,
                  }))
                }
                disabled={profilesLoading}
              >
                <option value="">Select an option</option>
                {PAM_ESCALATION_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {humanizeOption(option)}
                  </option>
                ))}
              </select>
            </div>
            <div className="portal-settings__field">
              <label htmlFor="pam-limit">Auto-approve limit (minor units)</label>
              <input
                id="pam-limit"
                type="number"
                inputMode="numeric"
                value={pamForm.limitMinorUnits}
                onChange={(event) =>
                  setPamForm((current) => ({
                    ...current,
                    limitMinorUnits: event.target.value,
                  }))
                }
                disabled={profilesLoading}
              />
            </div>
            <div className="portal-settings__field">
              <label htmlFor="pam-currency">Auto-approve currency</label>
              <input
                id="pam-currency"
                type="text"
                value={pamForm.currency}
                onChange={(event) =>
                  setPamForm((current) => ({
                    ...current,
                    currency: event.target.value,
                  }))
                }
                disabled={profilesLoading}
              />
            </div>
            <footer className="portal-settings__card-footer">
              <button
                type="submit"
                className="portal-settings__button"
                disabled={profilesLoading}
              >
                Save autonomy preferences
              </button>
            </footer>
            <p className="portal-settings__meta" aria-live="polite">
              {pamVersion ? `Current version: ${pamVersion}` : "No autonomy profile saved yet."}
            </p>
          </form>
        </article>

        <article className="portal-settings__card">
          <header className="portal-settings__card-header">
            <h2>Persona &amp; voice profile</h2>
            <p>Shape the assistant tone, verbosity, and voice settings.</p>
          </header>
          <form className="portal-settings__form" onSubmit={handlePvpSubmit}>
            <div className="portal-settings__grid">
              <div className="portal-settings__field">
                <label htmlFor="pvp-tone">Tone</label>
                <select
                  id="pvp-tone"
                  value={pvpForm.tone}
                  onChange={(event) =>
                    setPvpForm((current) => ({
                      ...current,
                      tone: event.target.value,
                    }))
                  }
                  disabled={profilesLoading}
                >
                  <option value="">Select an option</option>
                  {PVP_TONE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {humanizeOption(option)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="portal-settings__field">
                <label htmlFor="pvp-verbosity">Verbosity</label>
                <select
                  id="pvp-verbosity"
                  value={pvpForm.verbosity}
                  onChange={(event) =>
                    setPvpForm((current) => ({
                      ...current,
                      verbosity: event.target.value,
                    }))
                  }
                  disabled={profilesLoading}
                >
                  <option value="">Select an option</option>
                  {PVP_VERBOSITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {humanizeOption(option)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="portal-settings__field">
                <label htmlFor="pvp-initiative">Initiative</label>
                <select
                  id="pvp-initiative"
                  value={pvpForm.initiative}
                  onChange={(event) =>
                    setPvpForm((current) => ({
                      ...current,
                      initiative: event.target.value,
                    }))
                  }
                  disabled={profilesLoading}
                >
                  <option value="">Select an option</option>
                  {PVP_INITIATIVE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {humanizeOption(option)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="portal-settings__field">
                <label htmlFor="pvp-consent">Consent style</label>
                <select
                  id="pvp-consent"
                  value={pvpForm.consentStyle}
                  onChange={(event) =>
                    setPvpForm((current) => ({
                      ...current,
                      consentStyle: event.target.value,
                    }))
                  }
                  disabled={profilesLoading}
                >
                  <option value="">Select an option</option>
                  {PVP_CONSENT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {humanizeOption(option)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="portal-settings__field">
                <label htmlFor="pvp-emoji">Emoji &amp; GIFs</label>
                <select
                  id="pvp-emoji"
                  value={pvpForm.emojiGifs}
                  onChange={(event) =>
                    setPvpForm((current) => ({
                      ...current,
                      emojiGifs: event.target.value,
                    }))
                  }
                  disabled={profilesLoading}
                >
                  <option value="">Select an option</option>
                  {PVP_EMOJI_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {humanizeOption(option)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="portal-settings__field">
                <label htmlFor="pvp-language">Preferred language</label>
                <input
                  id="pvp-language"
                  type="text"
                  value={pvpForm.language}
                  onChange={(event) =>
                    setPvpForm((current) => ({
                      ...current,
                      language: event.target.value,
                    }))
                  }
                  disabled={profilesLoading}
                />
              </div>
              <div className="portal-settings__field">
                <label htmlFor="pvp-voice-id">Voice ID</label>
                <input
                  id="pvp-voice-id"
                  type="text"
                  value={pvpForm.voiceId}
                  onChange={(event) =>
                    setPvpForm((current) => ({
                      ...current,
                      voiceId: event.target.value,
                    }))
                  }
                  disabled={profilesLoading}
                />
              </div>
              <div className="portal-settings__field">
                <label htmlFor="pvp-pace">Voice pace</label>
                <input
                  id="pvp-pace"
                  type="number"
                  inputMode="decimal"
                  value={pvpForm.pace}
                  onChange={(event) =>
                    setPvpForm((current) => ({
                      ...current,
                      pace: event.target.value,
                    }))
                  }
                  disabled={profilesLoading}
                />
              </div>
              <div className="portal-settings__field">
                <label htmlFor="pvp-pitch">Voice pitch</label>
                <input
                  id="pvp-pitch"
                  type="number"
                  inputMode="decimal"
                  value={pvpForm.pitch}
                  onChange={(event) =>
                    setPvpForm((current) => ({
                      ...current,
                      pitch: event.target.value,
                    }))
                  }
                  disabled={profilesLoading}
                />
              </div>
              <div className="portal-settings__field">
                <label htmlFor="pvp-warmth">Voice warmth</label>
                <input
                  id="pvp-warmth"
                  type="number"
                  inputMode="decimal"
                  value={pvpForm.warmth}
                  onChange={(event) =>
                    setPvpForm((current) => ({
                      ...current,
                      warmth: event.target.value,
                    }))
                  }
                  disabled={profilesLoading}
                />
              </div>
            </div>
            <footer className="portal-settings__card-footer">
              <button
                type="submit"
                className="portal-settings__button"
                disabled={profilesLoading}
              >
                Save persona profile
              </button>
            </footer>
            <p className="portal-settings__meta" aria-live="polite">
              {pvpVersion ? `Current version: ${pvpVersion}` : "No persona profile saved yet."}
            </p>
          </form>
        </article>
      </section>
    </main>
  );
}
