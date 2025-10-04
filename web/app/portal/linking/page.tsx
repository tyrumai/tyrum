"use client";

import React, { useEffect, useState } from "react";

type IntegrationPreference = {
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
};

type PreferencesResponse = {
  account_id: string;
  integrations: IntegrationPreference[];
};

type UpdatePreferenceResponse = {
  status?: string;
  integration?: IntegrationPreference;
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

export default function AccountLinkingPage() {
  const [integrations, setIntegrations] = useState<IntegrationPreference[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPreferences() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/account-linking/preferences", {
          method: "GET",
          headers: {
            accept: "application/json",
          },
          cache: "no-store",
        });
        const payload = (await parseJsonResponse(response)) as PreferencesResponse & {
          error?: string;
          message?: string;
        };

        if (!response.ok) {
          const message =
            typeof payload?.message === "string"
              ? payload.message
              : "Unable to load account linking preferences.";
          throw new Error(message);
        }

        if (!cancelled) {
          setIntegrations(payload.integrations ?? []);
        }
      } catch (loadError) {
        if (!cancelled) {
          const message =
            loadError instanceof Error && loadError.message
              ? loadError.message
              : "Unable to load account linking preferences.";
          setError(message);
          setIntegrations([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadPreferences();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!successMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSuccessMessage(null);
    }, 3500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [successMessage]);

  const handleToggle = async (slug: string, nextEnabled: boolean) => {
    const current = integrations.find((integration) => integration.slug === slug);
    if (!current || pendingSlug) {
      return;
    }

    const previousEnabled = current.enabled;

    setPendingSlug(slug);
    setError(null);
    setSuccessMessage(null);
    setIntegrations((existing) =>
      existing.map((integration) =>
        integration.slug === slug
          ? { ...integration, enabled: nextEnabled }
          : integration,
      ),
    );

    try {
      const response = await fetch(
        `/api/account-linking/preferences/${encodeURIComponent(slug)}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ enabled: nextEnabled }),
          cache: "no-store",
        },
      );

      const payload = (await parseJsonResponse(response)) as UpdatePreferenceResponse & {
        message?: string;
      };

      if (!response.ok) {
        const message =
          typeof payload?.message === "string"
            ? payload.message
            : "Unable to persist linking preference.";
        throw new Error(message);
      }

      const updated = payload.integration ?? current;
      setIntegrations((existing) =>
        existing.map((integration) =>
          integration.slug === slug
            ? {
                ...integration,
                enabled: Boolean(updated.enabled),
                name: updated.name ?? integration.name,
                description: updated.description ?? integration.description,
              }
            : integration,
        ),
      );

      setSuccessMessage(
        updated.enabled
          ? `${updated.name ?? current.name} linked successfully.`
          : `${updated.name ?? current.name} linking disabled.`,
      );
    } catch (updateError) {
      const message =
        updateError instanceof Error && updateError.message
          ? updateError.message
          : "Unable to persist linking preference.";
      setError(message);
      setIntegrations((existing) =>
        existing.map((integration) =>
          integration.slug === slug
            ? { ...integration, enabled: previousEnabled }
            : integration,
        ),
      );
    } finally {
      setPendingSlug(null);
    }
  };

  return (
    <main className="portal-linking" aria-labelledby="linking-heading">
      <header className="portal-linking__header">
        <div>
          <p className="portal-linking__eyebrow">Portal</p>
          <h1 id="linking-heading">Account Linking</h1>
        </div>
        <p className="portal-linking__lead">
          Toggle placeholder connectors to show how Tyrum records data access consent before
          rolling out live integrations.
        </p>
      </header>

      {error ? (
        <p className="portal-linking__message portal-linking__message--error" role="alert">
          {error}
        </p>
      ) : null}
      {!error && successMessage ? (
        <p className="portal-linking__message portal-linking__message--success" role="status">
          {successMessage}
        </p>
      ) : null}

      <section
        aria-label="Integration toggles"
        className="portal-linking__grid"
        data-loading={isLoading}
      >
        {isLoading && integrations.length === 0 ? (
          <p className="portal-linking__placeholder" role="status">
            Loading account linking preferences…
          </p>
        ) : null}
        {!isLoading && integrations.length === 0 && !error ? (
          <p className="portal-linking__placeholder" role="status">
            No integrations available yet.
          </p>
        ) : null}
        {integrations.map((integration) => {
          const disabled = Boolean(isLoading || pendingSlug === integration.slug);
          const toggleLabel = integration.enabled ? "Linked" : "Link";
          return (
            <article className="portal-linking__card" key={integration.slug}>
              <header className="portal-linking__card-header">
                <div>
                  <h2>{integration.name}</h2>
                  <p>{integration.description}</p>
                </div>
                <span
                  className={
                    integration.enabled
                      ? "portal-linking__status-tag portal-linking__status-tag--enabled"
                      : "portal-linking__status-tag"
                  }
                  aria-live="polite"
                >
                  {integration.enabled ? "Linked" : "Not linked"}
                </span>
              </header>
              <footer className="portal-linking__card-footer">
                <label className="portal-linking__toggle" htmlFor={`toggle-${integration.slug}`}>
                  <input
                    type="checkbox"
                    id={`toggle-${integration.slug}`}
                    className="portal-linking__checkbox"
                    checked={integration.enabled}
                    onChange={(event) => handleToggle(integration.slug, event.target.checked)}
                    disabled={disabled}
                    aria-label={`${integration.enabled ? "Disable" : "Enable"} ${integration.name} integration`}
                  />
                  <span className="portal-linking__toggle-track" aria-hidden="true">
                    <span className="portal-linking__toggle-thumb" />
                  </span>
                  <span className="portal-linking__toggle-text">{toggleLabel}</span>
                </label>
              </footer>
            </article>
          );
        })}
      </section>
    </main>
  );
}
