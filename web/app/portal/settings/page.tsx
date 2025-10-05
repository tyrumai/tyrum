"use client";

import React, { useEffect, useRef, useState } from "react";

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

  const raiseToast = (tone: ToastTone, message: string) => {
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
  };

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
    </main>
  );
}
