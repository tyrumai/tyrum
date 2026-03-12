import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Network, type ConnectionStatus } from "@capacitor/network";
import { useEffect, useEffectEvent, useState } from "react";

export function useMobileRuntimeSignals(onReconnect: () => void): {
  appActive: boolean;
  networkStatus: ConnectionStatus | null;
} {
  const [appActive, setAppActive] = useState(true);
  const [networkStatus, setNetworkStatus] = useState<ConnectionStatus | null>(null);
  const reconnect = useEffectEvent(() => {
    onReconnect();
  });

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let disposed = false;
    const removeListeners: Array<() => void> = [];

    void App.getState().then((state) => {
      if (!disposed) {
        setAppActive(state.isActive);
      }
    });

    void Network.getStatus().then((status) => {
      if (!disposed) {
        setNetworkStatus(status);
      }
    });

    void App.addListener("appStateChange", (state) => {
      setAppActive(state.isActive);
      if (state.isActive) {
        reconnect();
      }
    }).then((listener) => {
      if (disposed) {
        void listener.remove();
        return;
      }
      removeListeners.push(() => {
        void listener.remove();
      });
    });

    void Network.addListener("networkStatusChange", (status) => {
      setNetworkStatus(status);
      if (status.connected) {
        reconnect();
      }
    }).then((listener) => {
      if (disposed) {
        void listener.remove();
        return;
      }
      removeListeners.push(() => {
        void listener.remove();
      });
    });

    return () => {
      disposed = true;
      for (const removeListener of removeListeners) {
        removeListener();
      }
    };
  }, []);

  return { appActive, networkStatus };
}
