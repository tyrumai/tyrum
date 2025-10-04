export type AnalyticsProperties = Record<string, string | undefined>;

type Plausible = (event: string, options?: { props?: Record<string, unknown> }) => void;

type SegmentAnalytics = {
  track?: (event: string, properties?: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    plausible?: Plausible;
    analytics?: SegmentAnalytics;
  }
}

export function trackAnalytics(
  event: string,
  properties: AnalyticsProperties = {},
): void {
  if (typeof window === "undefined") {
    return;
  }

  if (typeof window.plausible === "function") {
    window.plausible(event, { props: properties });
    return;
  }

  const analytics = window.analytics;
  if (analytics && typeof analytics.track === "function") {
    analytics.track(event, properties);
    return;
  }

  // Stub fallback so we can validate payloads locally without Plausible/Segment.
  // eslint-disable-next-line no-console -- intentional observability fallback
  console.info(`[analytics] ${event}`, properties);
}
