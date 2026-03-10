import {
  autoExecute,
  createBrowserLocalStorageDeviceIdentityStorage,
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
  TyrumClient,
  type TaskResult,
} from "@tyrum/client/browser";
import { type BrowserActionArgs } from "@tyrum/schemas";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Alert } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import {
  createBrowserCapabilityProvider,
  type BrowserConsentRequest,
  type RequestBrowserConsent,
} from "./browser-capability-provider.js";
import {
  readCapabilitySettingsFromStorage,
  readEnabledFromStorage,
  resolveBrowserCapabilityStates,
  toNodeCapabilityState,
  writeCapabilitySettingsToStorage,
  writeEnabledToStorage,
  type BrowserCapabilityName,
  type BrowserCapabilitySettings,
  type BrowserCapabilityState,
} from "./browser-node-capability-state.js";

type BrowserNodeStatus = "disabled" | "connecting" | "connected" | "disconnected" | "error";

export interface BrowserNodeState {
  enabled: boolean;
  status: BrowserNodeStatus;
  deviceId: string | null;
  clientId: string | null;
  error: string | null;
  capabilityStates: Record<BrowserCapabilityName, BrowserCapabilityState>;
}

export interface BrowserNodeApi extends BrowserNodeState {
  setEnabled: (enabled: boolean) => void;
  setCapabilityEnabled: (capability: BrowserCapabilityName, enabled: boolean) => void;
  executeLocal: (args: BrowserActionArgs) => Promise<TaskResult>;
}

const BrowserNodeContext = createContext<BrowserNodeApi | null>(null);
const DEVICE_IDENTITY_STORAGE_KEY = "tyrum.operator-ui.browserNode.deviceIdentity";

type ConsentQueueItem = {
  request: BrowserConsentRequest;
  resolve: (allowed: boolean) => void;
};

export function BrowserNodeProvider({
  wsUrl,
  children,
}: {
  wsUrl: string;
  children: ReactNode;
}): ReactElement {
  const [enabled, setEnabledState] = useState(() => readEnabledFromStorage());
  const [capabilitySettings, setCapabilitySettings] = useState<BrowserCapabilitySettings>(() =>
    readCapabilitySettingsFromStorage(),
  );
  const [status, setStatus] = useState<BrowserNodeStatus>(() =>
    enabled ? "connecting" : "disabled",
  );
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const capabilityStates = useMemo(
    () => resolveBrowserCapabilityStates(capabilitySettings),
    [capabilitySettings],
  );
  const capabilityStatesRef = useRef(capabilityStates);
  capabilityStatesRef.current = capabilityStates;

  const consentQueueRef = useRef<ConsentQueueItem[]>([]);
  const consentResolveRef = useRef<((allowed: boolean) => void) | null>(null);
  const consentActiveRef = useRef(false);
  const [consentRequest, setConsentRequest] = useState<BrowserConsentRequest | null>(null);

  const pumpConsentQueue = useCallback(() => {
    if (consentActiveRef.current) return;
    const next = consentQueueRef.current.shift();
    if (!next) return;
    consentActiveRef.current = true;
    consentResolveRef.current = next.resolve;
    setConsentRequest(next.request);
  }, []);

  const requestConsent: RequestBrowserConsent = useCallback(
    async (request) => {
      if (!enabledRef.current) return false;

      return await new Promise<boolean>((resolve) => {
        consentQueueRef.current.push({ request, resolve });
        pumpConsentQueue();
      });
    },
    [pumpConsentQueue],
  );

  const decideConsent = useCallback(
    (allowed: boolean) => {
      const resolve = consentResolveRef.current;
      consentResolveRef.current = null;
      consentActiveRef.current = false;
      setConsentRequest(null);
      resolve?.(allowed);
      pumpConsentQueue();
    },
    [pumpConsentQueue],
  );

  const clearConsentQueue = useCallback(() => {
    const resolveCurrent = consentResolveRef.current;
    consentResolveRef.current = null;
    consentActiveRef.current = false;
    setConsentRequest(null);
    resolveCurrent?.(false);

    if (consentQueueRef.current.length > 0) {
      const queued = consentQueueRef.current.splice(0);
      for (const item of queued) {
        item.resolve(false);
      }
    }
  }, []);

  const clientRef = useRef<TyrumClient | null>(null);
  const providerRef = useRef<ReturnType<typeof createBrowserCapabilityProvider> | null>(null);
  const publishCapabilityState = useCallback(async (client: TyrumClient) => {
    const capabilityState = toNodeCapabilityState(capabilityStatesRef.current);
    await client.capabilityReady({
      capabilities: [capabilityState.capability],
      capability_states: [capabilityState],
    });
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    writeEnabledToStorage(next);
  }, []);

  const setCapabilityEnabled = useCallback((capability: BrowserCapabilityName, next: boolean) => {
    setCapabilitySettings((current) => {
      const updated = { ...current, [capability]: next };
      writeCapabilitySettingsToStorage(updated);
      return updated;
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus("disabled");
      setError(null);
      setClientId(null);
      setDeviceId(null);
      clearConsentQueue();

      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      providerRef.current = null;
      return;
    }

    let disposed = false;
    setStatus("connecting");
    setError(null);

    void (async () => {
      let identity: Awaited<ReturnType<typeof loadOrCreateDeviceIdentity>>;
      try {
        identity = await loadOrCreateDeviceIdentity(
          createBrowserLocalStorageDeviceIdentityStorage(DEVICE_IDENTITY_STORAGE_KEY),
        );
      } catch (err) {
        if (disposed) return;
        setStatus("error");
        setError(formatDeviceIdentityError(err));
        return;
      }

      if (disposed) return;
      setDeviceId(identity.deviceId);

      const client = new TyrumClient({
        url: wsUrl,
        token: "",
        role: "node",
        capabilities: ["browser"],
        device: {
          deviceId: identity.deviceId,
          publicKey: identity.publicKey,
          privateKey: identity.privateKey,
          label: "operator-ui browser node",
          platform: "web",
          mode: "browser-node",
        },
      });

      clientRef.current = client;

      const baseProvider = createBrowserCapabilityProvider({ requestConsent });
      const provider = {
        ...baseProvider,
        execute: async (...args: Parameters<typeof baseProvider.execute>) => {
          const [action, ctx] = args;
          if (action.type === "Browser") {
            const browserArgs = action.args as BrowserActionArgs;
            const actionState = capabilityStatesRef.current[browserArgs.op];
            if (!actionState.enabled) {
              return {
                success: false,
                error: `action '${browserArgs.op}' is disabled by the operator`,
              };
            }
            if (actionState.availability_status === "unavailable") {
              return {
                success: false,
                error:
                  actionState.unavailable_reason ?? `action '${browserArgs.op}' is unavailable`,
              };
            }
          }
          return await baseProvider.execute(action, ctx);
        },
      };
      providerRef.current = provider;
      autoExecute(client, [provider]);

      const onConnected = (evt: unknown) => {
        if (disposed) return;
        const cid =
          evt && typeof evt === "object" && "clientId" in evt
            ? (evt as { clientId?: unknown }).clientId
            : undefined;
        setClientId(typeof cid === "string" ? cid : null);
        setStatus("connected");
        void publishCapabilityState(client);
      };

      const onDisconnected = () => {
        if (disposed) return;
        setClientId(null);
        setStatus(enabledRef.current ? "disconnected" : "disabled");
      };

      const onTransportError = (evt: unknown) => {
        if (disposed) return;
        const message =
          evt && typeof evt === "object" && "message" in evt
            ? (evt as { message?: unknown }).message
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
        return;
      }
    })();

    return () => {
      disposed = true;
      clearConsentQueue();
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      providerRef.current = null;
    };
  }, [clearConsentQueue, enabled, publishCapabilityState, requestConsent, wsUrl]);

  useEffect(() => {
    if (!enabled || status !== "connected" || !clientRef.current) return;
    void publishCapabilityState(clientRef.current);
  }, [capabilityStates, enabled, publishCapabilityState, status]);

  const executeLocal = useCallback(async (args: BrowserActionArgs): Promise<TaskResult> => {
    const provider = providerRef.current;
    if (!provider) {
      return { success: false, error: "browser node is not enabled" };
    }
    const actionState = capabilityStatesRef.current[args.op];
    if (!actionState.enabled) {
      return { success: false, error: `action '${args.op}' is disabled by the operator` };
    }
    if (actionState.availability_status === "unavailable") {
      return {
        success: false,
        error: actionState.unavailable_reason ?? `action '${args.op}' is unavailable`,
      };
    }

    return await provider.execute(
      { type: "Browser", args },
      { requestId: "local", runId: "local", stepId: "local", attemptId: "local" },
    );
  }, []);

  const value = useMemo<BrowserNodeApi>(
    () => ({
      enabled,
      status,
      deviceId,
      clientId,
      error,
      capabilityStates,
      setEnabled,
      setCapabilityEnabled,
      executeLocal,
    }),
    [
      capabilityStates,
      clientId,
      deviceId,
      enabled,
      error,
      executeLocal,
      setCapabilityEnabled,
      setEnabled,
      status,
    ],
  );

  return (
    <BrowserNodeContext.Provider value={value}>
      {children}

      <Dialog
        open={consentRequest !== null}
        onOpenChange={(nextOpen) => {
          if (nextOpen) return;
          decideConsent(false);
        }}
      >
        <DialogContent
          data-testid="browser-node-consent-dialog"
          aria-modal="true"
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            decideConsent(false);
          }}
          onPointerDownOutside={(event) => {
            event.preventDefault();
            decideConsent(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{consentRequest?.title ?? "Allow browser capability?"}</DialogTitle>
            {consentRequest?.description ? (
              <DialogDescription>{consentRequest.description}</DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="mt-4 grid gap-3">
            <Alert
              variant="warning"
              title="Browser permissions"
              description="You may see a browser permission prompt after allowing this action."
            />
            {consentRequest?.context ? (
              <div className="text-xs text-fg-muted">
                Attempt <code className="font-mono">{consentRequest.context.attemptId}</code>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                decideConsent(false);
              }}
            >
              Deny
            </Button>
            <Button
              type="button"
              onClick={() => {
                decideConsent(true);
              }}
            >
              Allow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BrowserNodeContext.Provider>
  );
}

export function useBrowserNode(): BrowserNodeApi {
  const value = useContext(BrowserNodeContext);
  if (!value) {
    throw new Error("useBrowserNode must be used within BrowserNodeProvider");
  }
  return value;
}

export function useBrowserNodeOptional(): BrowserNodeApi | null {
  return useContext(BrowserNodeContext);
}
