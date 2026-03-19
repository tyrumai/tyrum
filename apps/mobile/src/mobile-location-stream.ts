import { Capacitor } from "@capacitor/core";
import { Geolocation, type Position } from "@capacitor/geolocation";
import type { TyrumClient } from "@tyrum/transport-sdk/browser";
import type { LocationCoords, WsLocationBeaconPayload } from "@tyrum/contracts";
import type { MobileLocationStreamingConfig } from "./mobile-config.js";
import {
  calculateDistanceMeters,
  formatUnknownError,
  mapLocationCoords,
} from "./mobile-location-utils.js";

type SentSample = {
  recordedAtMs: number;
  coords: LocationCoords;
  isBackground: boolean;
};

type MobileLocationBeaconStreamOptions = {
  client: TyrumClient;
  onWatchError?: (message: string) => void;
};

type MobileLocationBeaconStream = {
  start: (config: MobileLocationStreamingConfig) => Promise<void>;
  stop: () => Promise<void>;
};

type NativeWatchOptions = {
  timeout: number;
  maximumAge: number;
};

function sameStreamingConfig(
  left: MobileLocationStreamingConfig | null,
  right: MobileLocationStreamingConfig,
): boolean {
  return (
    left !== null &&
    left.streamEnabled === right.streamEnabled &&
    left.distanceFilterM === right.distanceFilterM &&
    left.maxIntervalMs === right.maxIntervalMs &&
    left.maxAccuracyM === right.maxAccuracyM &&
    left.backgroundEnabled === right.backgroundEnabled
  );
}

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
  let desiredConfig: MobileLocationStreamingConfig | null = null;
  let desiredConfigRevision = 0;
  let watchId: Awaited<ReturnType<typeof Geolocation.watchPosition>> | null = null;
  let activeWatchOptions: NativeWatchOptions | null = null;
  let lastSentSample: SentSample | null = null;
  let lastQueuedSample: SentSample | null = null;
  let sendChain: Promise<void> = Promise.resolve();
  let lifecycleChain: Promise<void> = Promise.resolve();

  const resetSamples = (): void => {
    lastSentSample = null;
    lastQueuedSample = null;
  };

  const restoreQueuedBaseline = (sample: SentSample): void => {
    if (lastQueuedSample === sample) {
      lastQueuedSample = lastSentSample;
    }
  };

  const buildNativeWatchOptions = (config: MobileLocationStreamingConfig): NativeWatchOptions => ({
    timeout: config.maxIntervalMs,
    maximumAge: Math.min(config.maxIntervalMs, 60_000),
  });

  const watchOptionsMatch = (
    left: NativeWatchOptions | null,
    right: NativeWatchOptions,
  ): boolean => {
    if (!left) {
      return false;
    }
    return left.timeout === right.timeout && left.maximumAge === right.maximumAge;
  };

  const clearActiveWatch = async (): Promise<void> => {
    if (!watchId) {
      activeWatchOptions = null;
      return;
    }
    const currentWatchId = watchId;
    watchId = null;
    activeWatchOptions = null;
    await Geolocation.clearWatch({ id: currentWatchId });
  };

  const isStartStillDesired = (
    revision: number,
    nativeWatchOptions: NativeWatchOptions,
  ): boolean => {
    if (revision !== desiredConfigRevision) {
      return false;
    }
    if (!desiredConfig?.streamEnabled || !Capacitor.isNativePlatform()) {
      return false;
    }
    return watchOptionsMatch(buildNativeWatchOptions(desiredConfig), nativeWatchOptions);
  };

  const reconcileWatchLifecycle = async (): Promise<void> => {
    if (!desiredConfig?.streamEnabled || !Capacitor.isNativePlatform()) {
      await clearActiveWatch();
      return;
    }

    const nextWatchOptions = buildNativeWatchOptions(desiredConfig);
    if (watchId && watchOptionsMatch(activeWatchOptions, nextWatchOptions)) {
      return;
    }

    await clearActiveWatch();
    const revision = desiredConfigRevision;
    try {
      await Geolocation.requestPermissions();
      if (!isStartStillDesired(revision, nextWatchOptions)) {
        return;
      }

      const nextWatchId = await Geolocation.watchPosition(
        {
          enableHighAccuracy: false,
          ...nextWatchOptions,
        },
        handlePosition,
      );
      if (!isStartStillDesired(revision, nextWatchOptions)) {
        await Geolocation.clearWatch({ id: nextWatchId });
        return;
      }

      watchId = nextWatchId;
      activeWatchOptions = nextWatchOptions;
    } catch (error) {
      if (revision !== desiredConfigRevision) {
        return;
      }
      options.onWatchError?.(formatUnknownError(error));
    }
  };

  const enqueueLifecycleReconcile = (): Promise<void> => {
    lifecycleChain = lifecycleChain.then(reconcileWatchLifecycle, reconcileWatchLifecycle);
    return lifecycleChain;
  };

  const stop = async (): Promise<void> => {
    desiredConfig = null;
    desiredConfigRevision += 1;
    activeConfig = null;
    resetSamples();
    await enqueueLifecycleReconcile();
  };

  const emitBeacon = async (sample: SentSample): Promise<void> => {
    const payload: WsLocationBeaconPayload = {
      sample_id: crypto.randomUUID(),
      recorded_at: new Date(sample.recordedAtMs).toISOString(),
      coords: sample.coords,
      source: "unknown",
      is_background: sample.isBackground,
    };
    await options.client.locationBeacon(payload);
    lastSentSample = sample;
  };

  const handlePosition = (position: Position | null, error?: unknown): void => {
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
      isBackground: typeof document !== "undefined" ? document.hidden : false,
    };
    if (!shouldSendSample(activeConfig, nextSample, lastQueuedSample)) {
      return;
    }
    lastQueuedSample = nextSample;

    sendChain = sendChain
      .catch(() => {})
      .then(async () => {
        if (!activeConfig || isBackgroundBlocked(activeConfig)) {
          restoreQueuedBaseline(nextSample);
          return;
        }
        try {
          await emitBeacon(nextSample);
        } catch (sendError) {
          restoreQueuedBaseline(nextSample);
          throw sendError;
        }
      })
      .catch(() => {});
  };

  return {
    async start(config: MobileLocationStreamingConfig): Promise<void> {
      if (!config.streamEnabled || !Capacitor.isNativePlatform()) {
        await stop();
        return;
      }
      if (!sameStreamingConfig(activeConfig, config)) {
        resetSamples();
      }
      desiredConfig = { ...config };
      desiredConfigRevision += 1;
      activeConfig = desiredConfig;
      await enqueueLifecycleReconcile();
    },
    stop,
  };
}
