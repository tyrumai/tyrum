// @vitest-environment jsdom

import React, { act, useEffect } from "react";
import { expect, vi } from "vitest";
import type { BrowserNodeApi } from "@tyrum/operator-ui";
import { createTestRoot } from "../../../packages/operator-ui/tests/test-utils.js";

type BrowserNodeLifecycleInput = {
  client: {
    capabilityReady: (payload: unknown) => Promise<void>;
  };
  providers?: readonly unknown[];
  getCapabilityReadyPayload: () => unknown;
  onConnected?: (event: { clientId: string }) => void;
  onDisconnected?: () => void;
  onTransportError?: (event: { message?: unknown }) => void;
  onDispose?: () => void;
};

type Identity = {
  deviceId: string;
  publicKey: string;
  privateKey: string;
};

type DeferredIdentity = {
  promise: Promise<Identity>;
  resolve: (identity: Identity) => void;
  reject: (error: unknown) => void;
};

type RuntimeState = {
  clients: Array<{
    capabilityReady: ReturnType<typeof vi.fn<[unknown], Promise<void>>>;
    options: unknown;
  }>;
  connectMode: "connected" | "microtask";
  deferredIdentity: DeferredIdentity | null;
  disconnectOnDispose: boolean;
  identityError: unknown;
  identityMode: "resolve" | "reject" | "deferred";
  lifecycleInputs: BrowserNodeLifecycleInput[];
  publishCalls: unknown[];
  reset: () => void;
};

function createDeferredIdentity(): DeferredIdentity {
  let resolve!: (identity: Identity) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Identity>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

const runtimeState = vi.hoisted(
  (): RuntimeState => ({
    clients: [],
    connectMode: "connected",
    deferredIdentity: null,
    disconnectOnDispose: true,
    identityError: new Error("identity unavailable"),
    identityMode: "resolve",
    lifecycleInputs: [],
    publishCalls: [],
    reset() {
      this.clients.length = 0;
      this.connectMode = "connected";
      this.deferredIdentity = null;
      this.disconnectOnDispose = true;
      this.identityError = new Error("identity unavailable");
      this.identityMode = "resolve";
      this.lifecycleInputs.length = 0;
      this.publishCalls.length = 0;
    },
  }),
);

const capabilityStateMocks = vi.hoisted(() => ({
  toNodeCapabilityStates: vi.fn(),
}));

vi.mock("../src/browser-node/browser-node-capability-state.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/browser-node/browser-node-capability-state.js")
  >("../src/browser-node/browser-node-capability-state.js");
  capabilityStateMocks.toNodeCapabilityStates.mockImplementation(actual.toNodeCapabilityStates);
  return {
    ...actual,
    toNodeCapabilityStates: capabilityStateMocks.toNodeCapabilityStates,
  };
});

vi.mock("@tyrum/operator-ui", async () => {
  const actual = await vi.importActual<typeof import("@tyrum/operator-ui")>("@tyrum/operator-ui");
  return {
    ...actual,
    Alert: ({ description, title }: { description: string; title: string }) =>
      React.createElement(
        "div",
        { "data-testid": "browser-node-alert" },
        `${title}:${description}`,
      ),
    Button: ({
      children,
      onClick,
      type = "button",
      variant,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
      type?: "button" | "submit" | "reset";
      variant?: string;
    }) =>
      React.createElement(
        "button",
        {
          "data-variant": variant,
          onClick,
          type,
        },
        children,
      ),
    Dialog: ({
      children,
      onOpenChange,
      open,
    }: {
      children: React.ReactNode;
      onOpenChange: (open: boolean) => void;
      open: boolean;
    }) =>
      open
        ? React.createElement(
            "div",
            { "data-testid": "browser-node-dialog-root" },
            React.createElement(
              "button",
              {
                "data-testid": "browser-node-dialog-close",
                onClick: () => {
                  onOpenChange(false);
                },
                type: "button",
              },
              "close",
            ),
            children,
          )
        : null,
    DialogContent: ({
      children,
      onEscapeKeyDown,
      onPointerDownOutside,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & {
      onEscapeKeyDown: (event: { preventDefault: () => void }) => void;
      onPointerDownOutside: (event: { preventDefault: () => void }) => void;
    }) =>
      React.createElement(
        "div",
        props,
        React.createElement(
          "button",
          {
            "data-testid": "browser-node-dialog-escape",
            onClick: () => {
              onEscapeKeyDown({ preventDefault: () => undefined });
            },
            type: "button",
          },
          "escape",
        ),
        React.createElement(
          "button",
          {
            "data-testid": "browser-node-dialog-pointer-outside",
            onClick: () => {
              onPointerDownOutside({ preventDefault: () => undefined });
            },
            type: "button",
          },
          "outside",
        ),
        children,
      ),
    DialogDescription: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "browser-node-dialog-description" }, children),
    DialogFooter: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "browser-node-dialog-footer" }, children),
    DialogHeader: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "browser-node-dialog-header" }, children),
    DialogTitle: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "browser-node-dialog-title" }, children),
  };
});

vi.mock("../src/browser-node/browser-capability-provider.js", () => {
  const toConsentRequest = (op: unknown, ctx: unknown) => {
    if (op === "get") {
      return {
        scope: "geolocation",
        title: "Share location?",
        description: "A workflow is requesting your location via the browser geolocation API.",
        context: ctx,
      };
    }
    if (op === "capture_photo") {
      return {
        scope: "camera",
        title: "Allow camera capture?",
        description: "A workflow is requesting a photo from your camera.",
        context: ctx,
      };
    }
    return {
      scope: "microphone",
      title: "Allow microphone recording?",
      description: "A workflow is requesting a microphone recording.",
      context: ctx,
    };
  };

  return {
    createBrowserCapabilityProvider: vi.fn(
      ({ requestConsent }: { requestConsent: (request: unknown) => Promise<boolean> }) => ({
        capability: "browser",
        capabilityIds: ["tyrum.location.get", "tyrum.camera.capture-photo", "tyrum.audio.record"],
        async execute(action: { type: string; args: unknown }, ctx?: unknown) {
          if (action.type !== "Browser") {
            return {
              success: false,
              error: `unsupported action type: ${action.type}`,
            };
          }
          const op =
            action.args && typeof action.args === "object" && !Array.isArray(action.args)
              ? (action.args as { op?: unknown }).op
              : undefined;
          const allowed = await requestConsent(toConsentRequest(op, ctx));
          if (!allowed) {
            const deniedByOp =
              op === "get"
                ? "location access denied"
                : op === "capture_photo"
                  ? "camera access denied"
                  : "microphone access denied";
            return { success: false, error: deniedByOp };
          }
          return {
            success: true,
            evidence: {
              op,
              context: ctx ?? null,
            },
          };
        },
      }),
    ),
  };
});

vi.mock("../src/browser-node/browser-runtime.js", () => {
  class FakeTyrumClient {
    readonly capabilityReady = vi.fn<[unknown], Promise<void>>(async (_payload: unknown) => {});
    readonly options: unknown;

    constructor(options: unknown) {
      this.options = options;
      runtimeState.clients.push({
        capabilityReady: this.capabilityReady,
        options,
      });
    }
  }

  return {
    BrowserActionArgs: {
      safeParse(input: unknown) {
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          return { success: false, error: { message: "invalid browser args" } };
        }
        const op = (input as { op?: unknown }).op;
        if (op !== "get" && op !== "capture_photo" && op !== "record") {
          return { success: false, error: { message: "invalid browser args" } };
        }
        return { success: true, data: input };
      },
    },
    TyrumClient: FakeTyrumClient,
    createBrowserLocalStorageDeviceIdentityStorage: vi.fn((key: string) => ({ key })),
    createManagedNodeClientLifecycle: vi.fn((input: BrowserNodeLifecycleInput) => {
      runtimeState.lifecycleInputs.push(input);
      return {
        connect() {
          if (runtimeState.connectMode === "microtask") {
            queueMicrotask(() => {
              input.onConnected?.({ clientId: "late-client" });
            });
            return;
          }
          input.onConnected?.({ clientId: "client-1" });
          void input.client.capabilityReady(input.getCapabilityReadyPayload());
        },
        async publishCapabilityState() {
          const payload = input.getCapabilityReadyPayload();
          runtimeState.publishCalls.push(payload);
          await input.client.capabilityReady(payload);
        },
        dispose() {
          input.onDispose?.();
          if (runtimeState.disconnectOnDispose) {
            input.onDisconnected?.();
          }
        },
      };
    }),
    formatDeviceIdentityError: vi.fn((error: unknown) =>
      error instanceof Error ? error.message : String(error),
    ),
    loadOrCreateDeviceIdentity: vi.fn(async () => {
      if (runtimeState.identityMode === "reject") {
        throw runtimeState.identityError;
      }
      if (runtimeState.identityMode === "deferred") {
        if (!runtimeState.deferredIdentity) {
          runtimeState.deferredIdentity = createDeferredIdentity();
        }
        return await runtimeState.deferredIdentity.promise;
      }
      return {
        deviceId: "device-1",
        publicKey: "pub-1",
        privateKey: "priv-1",
      };
    }),
  };
});

export function stubLocalStorage(initial?: Record<string, string>): void {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  });
}

export function stubBrowserApis(options?: {
  geolocation?: boolean;
  mediaDevices?: boolean;
  mediaRecorder?: boolean;
  secureContext?: boolean;
}): void {
  const secureContext = options?.secureContext ?? true;
  vi.stubGlobal("isSecureContext", secureContext);
  vi.stubGlobal("navigator", {
    ...(options?.geolocation === false ? {} : { geolocation: { getCurrentPosition: vi.fn() } }),
    ...(options?.mediaDevices === false
      ? {}
      : {
          mediaDevices: {
            getUserMedia: vi.fn(),
          },
        }),
  });
  if (options?.mediaRecorder === false) {
    vi.stubGlobal("MediaRecorder", undefined);
    return;
  }
  vi.stubGlobal(
    "MediaRecorder",
    Object.assign(function MediaRecorderStub() {}, {
      isTypeSupported: () => true,
    }),
  );
}

export async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

export async function renderProvider(wsUrl = "ws://example.test/ws") {
  const [{ BrowserNodeProvider }, { useBrowserNode }] = await Promise.all([
    import("../src/browser-node/browser-node-provider.js"),
    import("@tyrum/operator-ui"),
  ]);
  let api: BrowserNodeApi | null = null;

  function ApiCapture({ onChange }: { onChange: (nextApi: BrowserNodeApi) => void }) {
    const browserNodeApi = useBrowserNode();
    useEffect(() => {
      onChange(browserNodeApi);
    }, [browserNodeApi, onChange]);
    return null;
  }

  const testRoot = createTestRoot();
  act(() => {
    testRoot.root.render(
      React.createElement(
        BrowserNodeProvider,
        { wsUrl },
        React.createElement(ApiCapture, {
          onChange: (nextApi) => {
            api = nextApi;
          },
        }),
      ),
    );
  });

  return {
    getApi() {
      expect(api).not.toBeNull();
      return api as BrowserNodeApi;
    },
    testRoot,
  };
}

export function clickByTestId(testId: string): void {
  const element = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  expect(element).not.toBeNull();
  act(() => {
    element?.click();
  });
}

export function resetBrowserNodeProviderHarness(): void {
  runtimeState.reset();
  capabilityStateMocks.toNodeCapabilityStates.mockClear();
}

export function cleanupBrowserNodeProviderHarness(): void {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
}

export function createDeferredBrowserNodeIdentity(): DeferredIdentity {
  return createDeferredIdentity();
}

export function getBrowserNodeRuntimeState(): RuntimeState {
  return runtimeState;
}

export function getToNodeCapabilityStatesMock(): typeof capabilityStateMocks.toNodeCapabilityStates {
  return capabilityStateMocks.toNodeCapabilityStates;
}
