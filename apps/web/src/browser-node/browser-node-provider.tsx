import {
  BrowserNodeProvider as BrowserNodeContextProvider,
  type BrowserNodeApi,
} from "../../../../packages/operator-ui/src/browser-node/browser-node-provider.js";
import { Alert } from "../../../../packages/operator-ui/src/components/ui/alert.js";
import { Button } from "../../../../packages/operator-ui/src/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../packages/operator-ui/src/components/ui/dialog.js";
import {
  createManagedNodeClientLifecycle,
  createBrowserLocalStorageDeviceIdentityStorage,
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
  TyrumClient,
  type ManagedNodeClientLifecycle,
  type TaskResult,
} from "./browser-runtime.js";
import { BrowserActionArgs } from "@tyrum/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import {
  createBrowserCapabilityProvider,
  type BrowserConsentRequest,
  type RequestBrowserConsent,
} from "./browser-capability-provider.js";
import {
  readCapabilitySettingsFromStorage,
  readEnabledFromStorage,
  resolveBrowserCapabilityStates,
  toNodeCapabilityStates,
  writeCapabilitySettingsToStorage,
  writeEnabledToStorage,
  type BrowserCapabilityName,
  type BrowserCapabilitySettings,
} from "./browser-node-capability-state.js";

const DEVICE_IDENTITY_STORAGE_KEY = "tyrum.operator-ui.browserNode.deviceIdentity";

type ConsentQueueItem = {
  request: BrowserConsentRequest;
  resolve: (allowed: boolean) => void;
};

function useBrowserConsentQueue(enabledRef: RefObject<boolean>) {
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
    [enabledRef, pumpConsentQueue],
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

  return { clearConsentQueue, consentRequest, decideConsent, requestConsent };
}

function BrowserConsentDialog({
  consentRequest,
  decideConsent,
}: {
  consentRequest: BrowserConsentRequest | null;
  decideConsent: (allowed: boolean) => void;
}) {
  return (
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
  );
}

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
  const [status, setStatus] = useState<BrowserNodeApi["status"]>(() =>
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
  const { clearConsentQueue, consentRequest, decideConsent, requestConsent } =
    useBrowserConsentQueue(enabledRef);

  const lifecycleRef = useRef<ManagedNodeClientLifecycle<TyrumClient> | null>(null);
  const providerRef = useRef<ReturnType<typeof createBrowserCapabilityProvider> | null>(null);

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

      lifecycleRef.current?.dispose();
      lifecycleRef.current = null;
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
        advertisedCapabilities: [
          { id: "tyrum.location.get", version: "1.0.0" },
          { id: "tyrum.camera.capture-photo", version: "1.0.0" },
          { id: "tyrum.audio.record", version: "1.0.0" },
        ],
        device: {
          deviceId: identity.deviceId,
          publicKey: identity.publicKey,
          privateKey: identity.privateKey,
          label: "operator-ui browser node",
          platform: "web",
          mode: "browser-node",
          device_type: "browser",
          device_platform: "web",
        },
      });
      const baseProvider = createBrowserCapabilityProvider({ requestConsent });
      const provider = {
        ...baseProvider,
        execute: async (...args: Parameters<typeof baseProvider.execute>) => {
          const [action, ctx] = args;
          if (action.type === "Browser") {
            const parsedArgs = BrowserActionArgs.safeParse(action.args);
            if (!parsedArgs.success) {
              return await baseProvider.execute(action, ctx);
            }

            const browserArgs = parsedArgs.data;
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
      const lifecycle = createManagedNodeClientLifecycle({
        client,
        providers: [provider],
        getCapabilityReadyPayload: () => {
          const capabilityStatesPayload = toNodeCapabilityStates(capabilityStatesRef.current);
          return {
            capabilities: capabilityStatesPayload.map(
              (capabilityState) => capabilityState.capability,
            ),
            capability_states: capabilityStatesPayload,
          };
        },
        onConnected: (event) => {
          if (disposed) return;
          setClientId(event.clientId);
          setStatus("connected");
        },
        onDisconnected: () => {
          if (disposed) return;
          setClientId(null);
          setStatus(enabledRef.current ? "disconnected" : "disabled");
        },
        onTransportError: (event) => {
          if (disposed) return;
          const message = event.message;
          if (typeof message === "string" && message.trim().length > 0) {
            setError(message);
          }
        },
        onDispose: () => {
          clearConsentQueue();
          if (providerRef.current === provider) {
            providerRef.current = null;
          }
        },
      });
      lifecycleRef.current = lifecycle;
      lifecycle.connect();

      if (disposed) {
        lifecycle.dispose();
        lifecycleRef.current = null;
        return;
      }
    })();

    return () => {
      disposed = true;
      clearConsentQueue();
      lifecycleRef.current?.dispose();
      lifecycleRef.current = null;
      providerRef.current = null;
    };
  }, [clearConsentQueue, enabled, requestConsent, wsUrl]);

  useEffect(() => {
    const lifecycle = lifecycleRef.current;
    if (!enabled || status !== "connected" || !lifecycle) return;
    void lifecycle.publishCapabilityState();
  }, [capabilityStates, enabled, status]);

  const executeLocal = useCallback(async (args: BrowserActionArgs): Promise<TaskResult> => {
    const provider = providerRef.current;
    if (!provider) {
      return { success: false, error: "browser node is not enabled" };
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
    <BrowserNodeContextProvider value={value}>
      {children}
      <BrowserConsentDialog consentRequest={consentRequest} decideConsent={decideConsent} />
    </BrowserNodeContextProvider>
  );
}
