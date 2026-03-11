import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import type { TyrumClient } from "@tyrum/client/browser";
import type { LocationCoords, WsLocationBeaconPayload } from "@tyrum/schemas";
import type { MobileLocationStreamingConfig } from "./mobile-config.js";
import {
  calculateDistanceMeters,
  formatUnknownError,
  mapLocationCoords,
} from "./mobile-location-utils.js";

type NativePosition = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude: number | null;
    altitudeAccuracy: number | null;
    heading: number | null;
    speed: number | null;
  };
  timestamp: number;
};

type SentSample = {
  recordedAtMs: number;
  coords: LocationCoords;
};

type MobileLocationBeaconStreamOptions = {
  client: TyrumClient;
  onWatchError?: (message: string) => void;
};

type MobileLocationBeaconStream = {
  start: (config: MobileLocationStreamingConfig) => Promise<void>;
  stop: () => Promise<void>;
};

function isBackgroundBlocked(config: MobileLocationStreamingConfig): boolean {
  return !config.backgroundEnabled && typeof document !== "undefined" && document.hidden;
}

function shouldSendSample(
  config: MobileLocationStreamingConfig,
  current: SentSample,
  previous: SentSample | null,
): boolean {
  if (current.coords.accuracy_m > config.maxAccuracyM) {
    return false;
  }
  if (!previous) {
    return true;
  }
  if (current.recordedAtMs - previous.recordedAtMs >= config.maxIntervalMs) {
    return true;
  }
  return calculateDistanceMeters(previous.coords, current.coords) >= config.distanceFilterM;
}

export function createMobileLocationBeaconStream(
  options: MobileLocationBeaconStreamOptions,
): MobileLocationBeaconStream {
  let activeConfig: MobileLocationStreamingConfig | null = null;
  let watchId: Awaited<ReturnType<typeof Geolocation.watchPosition>> | null = null;
  let lastSentSample: SentSample | null = null;
  let sendChain: Promise<void> = Promise.resolve();

  const stop = async (): Promise<void> => {
    activeConfig = null;
    lastSentSample = null;
    if (!watchId) {
      return;
    }
    const currentWatchId = watchId;
    watchId = null;
    await Geolocation.clearWatch({ id: currentWatchId });
  };

  const emitBeacon = async (sample: SentSample): Promise<void> => {
    const payload: WsLocationBeaconPayload = {
      sample_id: crypto.randomUUID(),
      recorded_at: new Date(sample.recordedAtMs).toISOString(),
      coords: sample.coords,
      source: "unknown",
      is_background: typeof document !== "undefined" ? document.hidden : false,
    };
    await options.client.locationBeacon(payload);
    lastSentSample = sample;
  };

  const handlePosition = (position: NativePosition | null, error?: unknown): void => {
    if (!activeConfig) return;
    if (error) {
      options.onWatchError?.(formatUnknownError(error));
      return;
    }
    if (!position || isBackgroundBlocked(activeConfig)) {
      return;
    }

    const nextSample: SentSample = {
      recordedAtMs: position.timestamp,
      coords: mapLocationCoords(position.coords),
    };
    if (!shouldSendSample(activeConfig, nextSample, lastSentSample)) {
      return;
    }

    sendChain = sendChain
      .catch(() => {})
      .then(async () => {
        if (!activeConfig || isBackgroundBlocked(activeConfig)) {
          return;
        }
        await emitBeacon(nextSample);
      })
      .catch(() => {});
  };

  return {
    async start(config: MobileLocationStreamingConfig): Promise<void> {
      activeConfig = { ...config };
      if (!config.streamEnabled || !Capacitor.isNativePlatform()) {
        await stop();
        return;
      }
      if (watchId) {
        return;
      }
      try {
        await Geolocation.requestPermissions();
        watchId = await Geolocation.watchPosition(
          {
            enableHighAccuracy: false,
            timeout: config.maxIntervalMs,
            maximumAge: Math.min(config.maxIntervalMs, 60_000),
          },
          handlePosition,
        );
      } catch (error) {
        options.onWatchError?.(formatUnknownError(error));
      }
    },
    stop,
  };
}
