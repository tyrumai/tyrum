"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityFeed } from "../../../components/activity-feed";
import {
  getGatewayClient,
  type ActivityEvent,
} from "../../../lib/gateway-client";

const POLL_INTERVAL_MS = 15_000;

export default function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const client = getGatewayClient();
      const data = await client.getEvents();
      if (isMountedRef.current) {
        const sorted = [...data].sort(
          (a, b) =>
            new Date(b.occurred_at).getTime() -
            new Date(a.occurred_at).getTime(),
        );
        setEvents(sorted);
        setError(null);
      }
    } catch (loadError) {
      if (isMountedRef.current) {
        const message =
          loadError instanceof Error && loadError.message
            ? loadError.message
            : "Unable to load activity.";
        setError(message);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadEvents();
    const interval = window.setInterval(loadEvents, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [loadEvents]);

  return (
    <main className="portal-activity" aria-labelledby="activity-heading">
      <header className="portal-activity__header">
        <div>
          <p className="portal-activity__eyebrow">Portal</p>
          <h1 id="activity-heading">Activity</h1>
        </div>
        <p className="portal-activity__lead">
          Live feed of events from the gateway, sorted by most recent first.
        </p>
      </header>

      {error ? (
        <p
          className="portal-activity__message portal-activity__message--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {isLoading && events.length === 0 ? (
        <p className="portal-activity__placeholder" role="status">
          Loading activity...
        </p>
      ) : null}

      {!isLoading ? <ActivityFeed events={events} /> : null}
    </main>
  );
}
