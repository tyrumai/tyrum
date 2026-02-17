"use client";

import type { ActivityEvent } from "../lib/gateway-client";

export interface ActivityFeedProps {
  events: ActivityEvent[];
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function summarizePayload(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload);
  if (keys.length === 0) {
    return "No payload";
  }
  const entries = keys.slice(0, 3).map((key) => {
    const value = payload[key];
    const display =
      typeof value === "string"
        ? value.length > 40
          ? `${value.slice(0, 40)}...`
          : value
        : JSON.stringify(value);
    return `${key}: ${display}`;
  });
  if (keys.length > 3) {
    entries.push(`+${keys.length - 3} more`);
  }
  return entries.join(", ");
}

export function ActivityFeed({ events }: ActivityFeedProps) {
  if (events.length === 0) {
    return (
      <p className="portal-activity__empty" role="status">
        No activity recorded yet.
      </p>
    );
  }

  return (
    <ol className="portal-activity__feed" aria-label="Activity timeline">
      {events.map((event) => (
        <li key={event.id} className="portal-activity__event">
          <div className="portal-activity__event-header">
            <span className="portal-activity__event-type">
              {event.event_type}
            </span>
            <span className="portal-activity__event-channel">
              {event.channel}
            </span>
            <time
              className="portal-activity__event-time"
              dateTime={event.occurred_at}
            >
              {formatTimestamp(event.occurred_at)}
            </time>
          </div>
          <p className="portal-activity__event-summary">
            {summarizePayload(event.payload)}
          </p>
        </li>
      ))}
    </ol>
  );
}
