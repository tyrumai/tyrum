import {
  autoExecute,
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
  TyrumClient,
} from "@tyrum/client/browser";
import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MobileHostApi, MobileHostState } from "@tyrum/operator-ui";
import type { MobileConnectionConfig } from "./mobile-config.js";
import { createNodeIdentityStorage } from "./mobile-config.js";
import { createMobileCapabilityProvider } from "./mobile-capability-provider.js";
import {
  buildMobileHostState,
  resolveMobileActionStates,
  resolveMobilePlatform,
  toNodeCapabilityState,
} from "./mobile-capability-state.js";

type UseMobileNodeOptions = {
  config: MobileConnectionConfig | null;
  token: string | null;
  updateConfig: (next: Partial<MobileConnectionConfig>) => Promise<MobileConnectionConfig | null>;
};

export function useMobileNode(options: UseMobileNodeOptions): {
  hostApi: MobileHostApi;
  state: MobileHostState;
} {
  const config = options.config;
  const token = options.token;
  const updateConfig = options.updateConfig;
  const platform = resolveMobilePlatform();
  const [status, setStatus] = useState<MobileHostState["status"]>("disconnected");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connectionConfig = useMemo(
    () =>
      config
        ? {
            httpBaseUrl: config.httpBaseUrl,
            wsUrl: config.wsUrl,
            nodeEnabled: config.nodeEnabled,
            actionSettings: config.actionSettings,
          }
        : null,
    [
      config?.actionSettings["audio.record_clip"],
      config?.actionSettings["camera.capture_photo"],
      config?.actionSettings["location.get_current"],
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

  const publishCapabilityState = useCallback(
    async (client: TyrumClient) => {
      await client.capabilityReady({
        capabilities: [toNodeCapabilityState(platform, actionStatesRef.current).capability],
        capability_states: [toNodeCapabilityState(platform, actionStatesRef.current)],
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
        device: {
          deviceId: identity.deviceId,
          publicKey: identity.publicKey,
          privateKey: identity.privateKey,
          label: `tyrum mobile ${platform}`,
          platform,
          mode: "mobile-node",
        },
      });
      clientRef.current = client;

      const provider = createMobileCapabilityProvider(platform);
      autoExecute(client, [provider]);

      const onConnected = () => {
        if (disposed) return;
        setStatus("connected");
        setError(null);
        void publishCapabilityState(client);
      };
      const onDisconnected = () => {
        if (disposed) return;
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
        client.disconnect();
      }
    })();

    return () => {
      disposed = true;
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [connectionConfig, enabled, platform, publishCapabilityState, token]);

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

  return { hostApi, state };
}
