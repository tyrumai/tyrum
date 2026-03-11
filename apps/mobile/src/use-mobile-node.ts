import {
  autoExecute,
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
  TyrumClient,
} from "@tyrum/client/browser";
import { Capacitor } from "@capacitor/core";
import { capabilityDescriptorsForClientCapability } from "@tyrum/schemas";
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
    return `Tyrum Mobile (${deviceName})`;
  }

  const manufacturer = optionalTrimmedString(deviceInfo?.manufacturer);
  const model = optionalTrimmedString(deviceInfo?.model);
  const deviceSummary = [manufacturer, model].filter((part) => part !== undefined).join(" ");
  if (deviceSummary) {
    return `Tyrum Mobile (${deviceSummary})`;
  }

  return `tyrum mobile ${platform}`;
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
  const connectionConfig = useMemo(
    () =>
      config
        ? {
            httpBaseUrl: config.httpBaseUrl,
            wsUrl: config.wsUrl,
            nodeEnabled: config.nodeEnabled,
            actionSettings: config.actionSettings,
            locationStreaming: config.locationStreaming,
          }
        : null,
    [
      config?.actionSettings["audio.record_clip"],
      config?.actionSettings["camera.capture_photo"],
      config?.actionSettings["location.get_current"],
      config?.locationStreaming.backgroundEnabled,
      config?.locationStreaming.distanceFilterM,
      config?.locationStreaming.maxAccuracyM,
      config?.locationStreaming.maxIntervalMs,
      config?.locationStreaming.streamEnabled,
      config?.httpBaseUrl,
      config?.nodeEnabled,
      config?.wsUrl,
    ],
  );

  const enabled = connectionConfig?.nodeEnabled ?? false;
  const actionStates = useMemo(
    () =>
      resolveMobileActionStates(
        connectionConfig?.actionSettings ?? {
          "location.get_current": true,
          "camera.capture_photo": true,
          "audio.record_clip": true,
        },
      ),
    [connectionConfig?.actionSettings],
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

  const clientRef = useRef<TyrumClient | null>(null);
  const retry = useCallback(() => {
    setReloadVersion((current) => current + 1);
  }, []);
  const locationStreamRef = useRef<ReturnType<typeof createMobileLocationBeaconStream> | null>(
    null,
  );

  const publishCapabilityState = useCallback(
    async (client: TyrumClient) => {
      const capabilityStates = toNodeCapabilityStates(platform, actionStatesRef.current);
      await client.capabilityReady({
        capabilities: capabilityStates.map((capabilityState) => capabilityState.capability),
        capability_states: capabilityStates,
      });
    },
    [platform],
  );

  useEffect(() => {
    const client = clientRef.current;
    if (!client || status !== "connected" || !enabled) return;
    void publishCapabilityState(client);
  }, [actionStates, enabled, publishCapabilityState, status]);

  useEffect(() => {
    if (!connectionConfig || !token || !enabled) {
      clientRef.current?.disconnect();
      clientRef.current = null;
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
      clientRef.current?.disconnect();
      clientRef.current = null;
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
        url: connectionConfig.wsUrl,
        token,
        role: "node",
        capabilities: [platform],
        advertisedCapabilities: capabilityDescriptorsForClientCapability(platform),
        device: {
          deviceId: identity.deviceId,
          publicKey: identity.publicKey,
          privateKey: identity.privateKey,
          label: buildMobileNodeLabel(platform, deviceInfo),
          platform: optionalTrimmedString(deviceInfo?.operatingSystem) ?? platform,
          version: optionalTrimmedString(deviceInfo?.osVersion),
          mode: "mobile-node",
        },
      });
      clientRef.current = client;

      const provider = createMobileCapabilityProvider(platform);
      const locationStream = createMobileLocationBeaconStream({
        client,
        onWatchError: (message) => {
          if (disposed) return;
          setError(message);
        },
      });
      locationStreamRef.current = locationStream;
      autoExecute(client, [provider]);

      const onConnected = () => {
        if (disposed) return;
        setStatus("connected");
        setError(null);
        void publishCapabilityState(client);
      };
      const onDisconnected = () => {
        if (disposed) return;
        void locationStream.stop();
        setStatus("disconnected");
      };
      const onTransportError = (event: unknown) => {
        if (disposed) return;
        const message =
          event && typeof event === "object" && "message" in event
            ? (event as { message?: unknown }).message
            : undefined;
        if (typeof message === "string" && message.trim().length > 0) {
          setError(message);
        }
      };

      client.on("connected", onConnected);
      client.on("disconnected", onDisconnected);
      client.on("transport_error", onTransportError);
      client.connect();

      if (disposed) {
        client.off("connected", onConnected);
        client.off("disconnected", onDisconnected);
        client.off("transport_error", onTransportError);
        void locationStream.stop();
        client.disconnect();
        locationStreamRef.current = null;
      }
    })();

    return () => {
      disposed = true;
      void locationStreamRef.current?.stop();
      clientRef.current?.disconnect();
      clientRef.current = null;
      locationStreamRef.current = null;
    };
  }, [connectionConfig, enabled, platform, publishCapabilityState, reloadVersion, token]);

  useEffect(() => {
    const locationStream = locationStreamRef.current;
    if (!locationStream) return;

    const locationStreaming = connectionConfig?.locationStreaming;
    const locationActionEnabled = connectionConfig?.actionSettings["location.get_current"] ?? false;
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
    connectionConfig?.actionSettings["location.get_current"],
    connectionConfig?.locationStreaming.backgroundEnabled,
    connectionConfig?.locationStreaming.distanceFilterM,
    connectionConfig?.locationStreaming.maxAccuracyM,
    connectionConfig?.locationStreaming.maxIntervalMs,
    connectionConfig?.locationStreaming.streamEnabled,
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
                "location.get_current": true,
                "camera.capture_photo": true,
                "audio.record_clip": true,
              },
            ),
          });
        },
        setActionEnabled: async (action, nextEnabled) => {
          const current = connectionConfig?.actionSettings ?? {
            "location.get_current": true,
            "camera.capture_photo": true,
            "audio.record_clip": true,
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
                "location.get_current": true,
                "camera.capture_photo": true,
                "audio.record_clip": true,
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
      connectionConfig?.actionSettings["audio.record_clip"],
      connectionConfig?.actionSettings["camera.capture_photo"],
      connectionConfig?.actionSettings["location.get_current"],
      platform,
      updateConfig,
    ],
  );

  return { hostApi, state, retry };
}
