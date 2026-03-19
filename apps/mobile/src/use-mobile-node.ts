import {
  createManagedNodeClientLifecycle,
  type ManagedNodeClientLifecycle,
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
  TyrumClient,
} from "@tyrum/node-sdk/browser";
import { Capacitor } from "@capacitor/core";
import { Clipboard } from "@capacitor/clipboard";
import { Device, type DeviceInfo } from "@capacitor/device";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MobileHostApi, MobileHostState } from "@tyrum/operator-ui";
import type { MobileConnectionConfig } from "./mobile-config.js";
import { createNodeIdentityStorage } from "./mobile-config.js";
import { createMobileCapabilityProvider } from "./mobile-capability-provider.js";
import { createMobileLocationBeaconStream } from "./mobile-location-stream.js";
import {
  buildMobileHostState,
  resolveMobileActionStates,
  resolveMobilePlatform,
  toNodeCapabilityStates,
} from "./mobile-capability-state.js";

type UseMobileNodeOptions = {
  config: MobileConnectionConfig | null;
  token: string | null;
  updateConfig: (next: Partial<MobileConnectionConfig>) => Promise<MobileConnectionConfig | null>;
};

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildMobileNodeLabel(platform: string, deviceInfo: DeviceInfo | null): string {
  const deviceName = optionalTrimmedString(deviceInfo?.name);
  if (deviceName) {
    return `Tyrum mobile app (${deviceName})`;
  }

  const manufacturer = optionalTrimmedString(deviceInfo?.manufacturer);
  const model = optionalTrimmedString(deviceInfo?.model);
  const deviceSummary = [manufacturer, model].filter((part) => part !== undefined).join(" ");
  if (deviceSummary) {
    return `Tyrum mobile app (${deviceSummary})`;
  }

  return `Tyrum mobile app (${platform})`;
}

async function loadNativeDeviceInfo(): Promise<DeviceInfo | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await Device.getInfo();
  } catch {
    return null;
  }
}

export function useMobileNode(options: UseMobileNodeOptions): {
  hostApi: MobileHostApi;
  state: MobileHostState;
  retry: () => void;
} {
  const config = options.config;
  const token = options.token;
  const updateConfig = options.updateConfig;
  const platform = resolveMobilePlatform();
  const [status, setStatus] = useState<MobileHostState["status"]>("disconnected");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const enabled = config?.nodeEnabled ?? false;
  const wsUrl = config?.wsUrl ?? null;
  const actionSettings = config?.actionSettings;
  const locationStreaming = config?.locationStreaming;
  const locationActionEnabled = actionSettings?.["get"] ?? false;
  const actionStates = useMemo(
    () =>
      resolveMobileActionStates(
        actionSettings ?? {
          get: true,
          capture_photo: true,
          record: true,
        },
      ),
    [actionSettings?.["record"], actionSettings?.["capture_photo"], actionSettings?.["get"]],
  );

  const actionStatesRef = useRef(actionStates);
  actionStatesRef.current = actionStates;

  const state = useMemo(
    () =>
      buildMobileHostState({
        platform,
        enabled,
        status,
        deviceId,
        error,
        actions: actionStates,
      }),
    [actionStates, deviceId, enabled, error, platform, status],
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  const listenersRef = useRef(new Set<(next: MobileHostState) => void>());
  useEffect(() => {
    for (const listener of listenersRef.current) {
      listener(state);
    }
  }, [state]);

  const lifecycleRef = useRef<ManagedNodeClientLifecycle<TyrumClient> | null>(null);
  const retry = useCallback(() => {
    setReloadVersion((current) => current + 1);
  }, []);
  const locationStreamRef = useRef<ReturnType<typeof createMobileLocationBeaconStream> | null>(
    null,
  );

  useEffect(() => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle || status !== "connected" || !enabled) return;
    void lifecycle.publishCapabilityState();
  }, [actionStates, enabled, status]);

  useEffect(() => {
    if (!wsUrl || !token || !enabled) {
      lifecycleRef.current?.dispose();
      lifecycleRef.current = null;
      setStatus("disconnected");
      setDeviceId(null);
      if (!Capacitor.isNativePlatform()) {
        setError("Local mobile node support is only enabled on Capacitor iOS and Android targets.");
      } else {
        setError(null);
      }
      return;
    }

    if (!Capacitor.isNativePlatform()) {
      lifecycleRef.current?.dispose();
      lifecycleRef.current = null;
      setStatus("disconnected");
      setDeviceId(null);
      setError("Local mobile node support is only enabled on Capacitor iOS and Android targets.");
      return;
    }

    let disposed = false;
    setStatus("connecting");
    setError(null);

    void (async () => {
      let identity: Awaited<ReturnType<typeof loadOrCreateDeviceIdentity>>;
      const deviceInfo = await loadNativeDeviceInfo();
      if (disposed) return;
      try {
        identity = await loadOrCreateDeviceIdentity(createNodeIdentityStorage());
      } catch (loadError) {
        if (disposed) return;
        setStatus("disconnected");
        setError(formatDeviceIdentityError(loadError));
        return;
      }
      if (disposed) return;

      setDeviceId(identity.deviceId);
      const client = new TyrumClient({
        url: wsUrl,
        token,
        role: "node",
        capabilities: [platform],
        advertisedCapabilities: [
          { id: "tyrum.location.get", version: "1.0.0" },
          { id: "tyrum.camera.capture-photo", version: "1.0.0" },
          { id: "tyrum.audio.record", version: "1.0.0" },
        ],
        device: {
          deviceId: identity.deviceId,
          publicKey: identity.publicKey,
          privateKey: identity.privateKey,
          label: buildMobileNodeLabel(platform, deviceInfo),
          platform: optionalTrimmedString(deviceInfo?.operatingSystem) ?? platform,
          version: optionalTrimmedString(deviceInfo?.osVersion),
          mode: "mobile-node",
          device_type: "phone",
          device_platform: platform === "ios" ? "ios" : "android",
        },
      });
      const provider = createMobileCapabilityProvider(platform);
      const locationStream = createMobileLocationBeaconStream({
        client,
        onWatchError: (message) => {
          if (disposed) return;
          setError(message);
        },
      });
      locationStreamRef.current = locationStream;
      const lifecycle = createManagedNodeClientLifecycle({
        client,
        providers: [provider],
        getCapabilityReadyPayload: () => {
          const capabilityStates = toNodeCapabilityStates(actionStatesRef.current);
          return {
            capabilities: capabilityStates.map((capabilityState) => capabilityState.capability),
            capability_states: capabilityStates,
          };
        },
        onConnected: () => {
          if (disposed) return;
          setStatus("connected");
          setError(null);
        },
        onDisconnected: () => {
          if (disposed) return;
          void locationStream.stop();
          setStatus("disconnected");
        },
        onTransportError: (event) => {
          if (disposed) return;
          const message = event.message;
          if (typeof message === "string" && message.trim().length > 0) {
            setError(message);
          }
        },
        onDispose: () => {
          void locationStream.stop();
          if (locationStreamRef.current === locationStream) {
            locationStreamRef.current = null;
          }
        },
      });
      lifecycleRef.current = lifecycle;
      lifecycle.connect();

      if (disposed) {
        lifecycle.dispose();
        lifecycleRef.current = null;
        void locationStream.stop();
        locationStreamRef.current = null;
      }
    })();

    return () => {
      disposed = true;
      lifecycleRef.current?.dispose();
      lifecycleRef.current = null;
      void locationStreamRef.current?.stop();
      locationStreamRef.current = null;
    };
  }, [enabled, platform, reloadVersion, token, wsUrl]);

  useEffect(() => {
    const locationStream = locationStreamRef.current;
    if (!locationStream) return;

    if (
      status !== "connected" ||
      !enabled ||
      !locationActionEnabled ||
      !locationStreaming?.streamEnabled
    ) {
      void locationStream.stop();
      return;
    }

    void locationStream.start(locationStreaming);

    return () => {
      void locationStream.stop();
    };
  }, [
    locationActionEnabled,
    locationStreaming?.backgroundEnabled,
    locationStreaming?.distanceFilterM,
    locationStreaming?.maxAccuracyM,
    locationStreaming?.maxIntervalMs,
    locationStreaming?.streamEnabled,
    enabled,
    status,
  ]);

  const hostApi = useMemo<MobileHostApi>(
    () => ({
      node: {
        getState: async () => stateRef.current,
        setEnabled: async (nextEnabled) => {
          const updated = await updateConfig({ nodeEnabled: nextEnabled });
          return buildMobileHostState({
            platform,
            enabled: updated?.nodeEnabled ?? false,
            status: stateRef.current.status,
            deviceId: stateRef.current.deviceId,
            error: stateRef.current.error,
            actions: resolveMobileActionStates(
              updated?.actionSettings ?? {
                get: true,
                capture_photo: true,
                record: true,
              },
            ),
          });
        },
        setActionEnabled: async (action, nextEnabled) => {
          const current = config?.actionSettings ?? {
            get: true,
            capture_photo: true,
            record: true,
          };
          const updated = await updateConfig({
            actionSettings: { ...current, [action]: nextEnabled },
          });
          return buildMobileHostState({
            platform,
            enabled: updated?.nodeEnabled ?? false,
            status: stateRef.current.status,
            deviceId: stateRef.current.deviceId,
            error: stateRef.current.error,
            actions: resolveMobileActionStates(
              updated?.actionSettings ?? {
                get: true,
                capture_photo: true,
                record: true,
              },
            ),
          });
        },
      },
      clipboard: {
        writeText: async (text) => {
          await Clipboard.write({ string: text });
        },
      },
      onStateChange: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    [
      config?.actionSettings["record"],
      config?.actionSettings["capture_photo"],
      config?.actionSettings["get"],
      platform,
      updateConfig,
    ],
  );

  return { hostApi, state, retry };
}
