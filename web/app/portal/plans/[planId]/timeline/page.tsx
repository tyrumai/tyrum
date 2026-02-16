"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type TimelineAction = Record<string, unknown>;

type TimelineEvent = {
  replay_id?: string;
  step_index?: number;
  occurred_at?: string;
  recorded_at?: string;
  action?: TimelineAction;
  voice_rationale?: string;
  redactions?: string[];
};

type TimelineResponse = {
  plan_id?: string;
  generated_at?: string;
  event_count?: number;
  has_redactions?: boolean;
  events?: TimelineEvent[];
};

type TimelineError = {
  error?: string;
  message?: string;
};

type FetchState =
  | { status: "idle" | "loading" }
  | { status: "loaded"; timeline: TimelineResponse }
  | { status: "error"; message: string };

function parseJsonResponse(response: Response) {
  return response.text().then((raw) => {
    if (!raw) {
      return {};
    }

    try {
      return JSON.parse(raw) as TimelineResponse | TimelineError;
    } catch {
      return { message: raw } satisfies TimelineError;
    }
  });
}

function formatDateTime(isoString?: string) {
  if (!isoString) {
    return "Unknown";
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function ensureString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function extractStatus(action?: TimelineAction) {
  if (!action) {
    return "unknown";
  }

  const result = action.result as TimelineAction | undefined;
  const status = ensureString(result?.status) ?? ensureString(action.status);
  if (status) {
    return status;
  }

  if (ensureString(action.kind)) {
    return action.kind as string;
  }

  return "unknown";
}

function extractExecutor(action?: TimelineAction) {
  if (!action) {
    return undefined;
  }

  const executor =
    ensureString(action.executor) ??
    ensureString((action.executor as TimelineAction | undefined)?.name);
  if (executor) {
    return executor;
  }

  const primitive = action.primitive as TimelineAction | undefined;
  return ensureString(primitive?.executor);
}

function extractReason(action?: TimelineAction) {
  if (!action) {
    return undefined;
  }

  const result = action.result as TimelineAction | undefined;
  const detail =
    ensureString(result?.detail) ??
    ensureString(result?.message) ??
    ensureString(result?.notes);

  if (detail) {
    return detail;
  }

  return ensureString(action.reason);
}

function isRedacted(value?: string) {
  if (!value) {
    return false;
  }

  return value.trim().toLowerCase() === "[redacted]";
}

function humanizeLabel(value: string) {
  if (!value) {
    return "Unknown";
  }

  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .map((segment) => {
      if (!segment) {
        return segment;
      }
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(" ")
    .trim();
}

function extractErrorMessage(
  payload: TimelineResponse | TimelineError | undefined,
) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  if (
    "message" in payload &&
    typeof (payload as TimelineError).message === "string"
  ) {
    return (payload as TimelineError).message;
  }

  return undefined;
}

function isTimelineResponse(
  payload: TimelineResponse | TimelineError | undefined,
): payload is TimelineResponse {
  return !!payload && typeof payload === "object" && "events" in payload;
}

function statusVariant(status: string) {
  const normalized = status.trim().toLowerCase();
  if (["success", "succeeded", "ok", "completed"].includes(normalized)) {
    return "success";
  }
  if (["failure", "failed", "error", "denied"].includes(normalized)) {
    return "error";
  }
  if (["pending", "waiting", "in_progress", "queued"].includes(normalized)) {
    return "pending";
  }
  return "unknown";
}

export default function PlanTimelinePage() {
  const params = useParams();
  const planIdParam = params?.planId;
  const planId = useMemo(() => {
    if (Array.isArray(planIdParam)) {
      return ensureString(planIdParam[0])?.trim() ?? "";
    }
    return ensureString(planIdParam)?.trim() ?? "";
  }, [planIdParam]);

  const [state, setState] = useState<FetchState>({ status: "idle" });

  useEffect(() => {
    if (!planId) {
      setState({
        status: "error",
        message: "Plan identifier is missing from the URL.",
      });
      return;
    }

    let aborted = false;
    const controller = new AbortController();
    setState({ status: "loading" });

    fetch(`/api/audit/plan/${encodeURIComponent(planId)}`, {
      method: "GET",
      headers: {
        accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await parseJsonResponse(response)) as
          | TimelineResponse
          | TimelineError
          | undefined;
        if (aborted) {
          return;
        }

        if (!response.ok) {
          const message =
            extractErrorMessage(payload) ??
            "Unable to load the audit timeline.";
          setState({ status: "error", message });
          return;
        }

        if (isTimelineResponse(payload)) {
          setState({ status: "loaded", timeline: payload });
          return;
        }

        setState({
          status: "error",
          message: "Audit timeline payload was malformed.",
        });
      })
      .catch((error) => {
        if (aborted) {
          return;
        }

        const message =
          error instanceof Error && error.message
            ? error.message
            : "Unable to reach the audit service.";
        setState({ status: "error", message });
      });

    return () => {
      aborted = true;
      controller.abort();
    };
  }, [planId]);

  const timeline =
    state.status === "loaded" ? state.timeline : undefined;
  const events = timeline?.events ?? [];

  return (
    <main className="portal-timeline" aria-labelledby="timeline-heading">
      <header className="portal-timeline__header">
        <p className="portal-timeline__eyebrow">Audit Console</p>
        <h1 id="timeline-heading">Plan timeline</h1>
        <p className="portal-timeline__lead">
          Review executor outcomes, planner summaries, and policy decisions for the
          selected plan. Redactions hide sensitive fields while keeping the audit
          trail navigable.
        </p>
        {planId ? (
          <a
            className="portal-timeline__raw-link"
            href={`/api/audit/plan/${encodeURIComponent(planId)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View raw timeline JSON
          </a>
        ) : null}
      </header>

      {state.status === "loading" ? (
        <p role="status" className="portal-timeline__status-message">
          Loading timeline…
        </p>
      ) : null}

      {state.status === "error" ? (
        <p
          role="alert"
          className="portal-timeline__status-message portal-timeline__status-message--error"
        >
          {state.message}
        </p>
      ) : null}

      {timeline ? (
        <>
          <section className="portal-timeline__meta" aria-label="Plan summary">
            <div className="portal-timeline__meta-item">
              <span className="portal-timeline__meta-label">Plan ID</span>
              <code className="portal-timeline__meta-value">{timeline.plan_id ?? planId}</code>
            </div>
            <div className="portal-timeline__meta-item">
              <span className="portal-timeline__meta-label">Generated</span>
              <time
                className="portal-timeline__meta-value"
                dateTime={timeline.generated_at}
              >
                {formatDateTime(timeline.generated_at)}
              </time>
            </div>
            <div className="portal-timeline__meta-item">
              <span className="portal-timeline__meta-label">Events</span>
              <span className="portal-timeline__meta-value">
                {timeline.event_count ?? events.length}
              </span>
            </div>
            <div className="portal-timeline__meta-item">
              <span className="portal-timeline__meta-label">Redactions</span>
              <span className="portal-timeline__meta-value">
                {timeline.has_redactions ? "Present" : "None detected"}
              </span>
            </div>
          </section>

          <section aria-labelledby="timeline-events-heading">
            <h2 id="timeline-events-heading" className="portal-timeline__subheading">
              Timeline events
            </h2>
            <ol className="portal-timeline__events" role="list">
              {events.length === 0 ? (
                <li className="portal-timeline__event portal-timeline__event--empty">
                  No audit events recorded for this plan yet.
                </li>
              ) : (
                events.map((event) => {
                  const status = extractStatus(event.action);
                  const statusLabel = humanizeLabel(status);
                  const variant = statusVariant(status);
                  const executor =
                    extractExecutor(event.action) ?? "Unknown executor";
                  const fallbackReason = extractReason(event.action);
                  const voiceRationale = ensureString(event.voice_rationale);
                  const chosenReason = voiceRationale ?? fallbackReason;
                  const reasonRedacted = isRedacted(chosenReason);
                  const redactions = event.redactions ?? [];
                  const stepNumber =
                    typeof event.step_index === "number"
                      ? event.step_index + 1
                      : "?";

                  const displayReason = reasonRedacted
                    ? "Hidden for privacy (redacted)."
                    : chosenReason ?? "No reason provided.";

                  return (
                    <li key={event.replay_id ?? `event-${event.step_index}`} className="portal-timeline__event">
                      <div className="portal-timeline__event-header">
                        <span
                          className={`portal-timeline__status portal-timeline__status--${variant}`}
                          aria-label={`Status: ${statusLabel}`}
                        >
                          {statusLabel}
                        </span>
                        <span className="portal-timeline__event-meta">
                          Step {stepNumber}
                        </span>
                        <span className="portal-timeline__event-meta">
                          Executor: {executor}
                        </span>
                        <span className="portal-timeline__event-meta">
                          <time dateTime={event.occurred_at}>
                            Occurred {formatDateTime(event.occurred_at)}
                          </time>
                        </span>
                      </div>
                      <div className="portal-timeline__event-body">
                        <p className="portal-timeline__reason">
                          <span className="portal-timeline__reason-label">Reason</span>
                          <span>
                            {displayReason}
                          </span>
                        </p>
                        {ensureString(event.action?.kind) ? (
                          <p className="portal-timeline__kind">
                            Action kind:{" "}
                            {humanizeLabel(ensureString(event.action?.kind) ?? "unknown")}
                          </p>
                        ) : null}
                        {redactions.length > 0 ? (
                          <div className="portal-timeline__redactions" role="note">
                            <span className="portal-timeline__redaction-badge">
                              Redactions applied
                            </span>
                            <ul className="portal-timeline__redaction-list">
                              {redactions.map((path) => (
                                <li key={path}>
                                  <code>{path}</code>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                      {event.replay_id ? (
                        <a
                          className="portal-timeline__raw-link portal-timeline__raw-link--inline"
                          href={`/api/audit/plan/${encodeURIComponent(planId)}?event=${encodeURIComponent(event.replay_id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View raw event JSON
                        </a>
                      ) : null}
                    </li>
                  );
                })
              )}
            </ol>
          </section>
        </>
      ) : null}
    </main>
  );
}
