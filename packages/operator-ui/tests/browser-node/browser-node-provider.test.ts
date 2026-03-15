// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, useEffect } from "react";
import { cleanupTestRoot, createTestRoot } from "../test-utils.js";

const clientInstances: FakeTyrumClient[] = [];

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

type TyrumClientHandler = (evt?: unknown) => void;

class FakeTyrumClient {
  #handlers = new Map<string, Set<TyrumClientHandler>>();
  readonly capabilityReady = vi.fn(async () => {});

  constructor() {
    clientInstances.push(this);
  }

  on(event: string, handler: TyrumClientHandler): void {
    const set = this.#handlers.get(event) ?? new Set();
    set.add(handler);
    this.#handlers.set(event, set);
  }

  off(event: string, handler: TyrumClientHandler): void {
    const set = this.#handlers.get(event);
    set?.delete(handler);
  }

  connect(): void {
    this.#emit("connected", { clientId: "client-1" });
  }

  disconnect(): void {
    this.#emit("disconnected");
  }

  emit(event: string, evt?: unknown): void {
    this.#emit(event, evt);
  }

  #emit(event: string, evt?: unknown): void {
    const set = this.#handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      handler(evt);
    }
  }
}

vi.mock("@tyrum/client/browser", () => {
  const autoExecute = vi.fn();

  return {
    autoExecute,
    createManagedNodeClientLifecycle: vi.fn((input: {
      client: FakeTyrumClient;
      providers: readonly unknown[];
      getCapabilityReadyPayload: () => unknown;
      onConnected?: (event: { clientId: string }) => void;
      onDisconnected?: () => void;
      onTransportError?: (event: { message: string }) => void;
      onDispose?: () => void;
    }) => {
      let disposed = false;
      let connected = false;

      const handleConnected = (event?: unknown) => {
        if (disposed || !event || typeof event !== "object") return;
        connected = true;
        input.onConnected?.(event as { clientId: string });
        void input.client.capabilityReady(input.getCapabilityReadyPayload());
      };
      const handleDisconnected = () => {
        connected = false;
        if (disposed) return;
        input.onDisconnected?.();
      };
      const handleTransportError = (event?: unknown) => {
        if (disposed || !event || typeof event !== "object") return;
        input.onTransportError?.(event as { message: string });
      };

      autoExecute(input.client, [...input.providers]);
      input.client.on("connected", handleConnected);
      input.client.on("disconnected", handleDisconnected);
      input.client.on("transport_error", handleTransportError);

      return {
        client: input.client,
        connect() {
          if (disposed) return;
          input.client.connect();
        },
        async publishCapabilityState() {
          if (disposed || !connected) return;
          await input.client.capabilityReady(input.getCapabilityReadyPayload());
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          input.client.off("connected", handleConnected);
          input.client.off("disconnected", handleDisconnected);
          input.client.off("transport_error", handleTransportError);
          input.onDispose?.();
          input.client.disconnect();
        },
      };
    }),
    createBrowserLocalStorageDeviceIdentityStorage: vi.fn((_key: string) => ({})),
    formatDeviceIdentityError: vi.fn((err: unknown) => String(err)),
    loadOrCreateDeviceIdentity: vi.fn(async () => ({
      deviceId: "device-1",
      publicKey: "pub-1",
      privateKey: "priv-1",
    })),
    TyrumClient: FakeTyrumClient,
  };
});

function stubLocalStorage(initial?: Record<string, string>): void {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
}

function stubBrowserApis(): void {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: vi.fn(),
    },
    mediaDevices: {
      getUserMedia: vi.fn(),
    },
  });
  const MediaRecorderStub = Object.assign(function MediaRecorderStub() {}, {
    isTypeSupported: () => true,
  });
  vi.stubGlobal("MediaRecorder", MediaRecorderStub);
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function clickButton(label: string): Promise<void> {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((el) =>
    el.textContent?.includes(label),
  );
  expect(button).not.toBeUndefined();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  clientInstances.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BrowserNodeProvider", () => {
  it("routes local execution through the provider capability guard", async () => {
    const { BrowserNodeProvider, useBrowserNode } =
      await import("../../src/browser-node/browser-node-provider.js");

    stubLocalStorage({ "tyrum.operator-ui.browserNode.enabled": "1" });
    stubBrowserApis();

    let capturedApi: any = null;

    function ApiCapture({ onChange }: { onChange: (api: unknown) => void }) {
      const api = useBrowserNode();
      useEffect(() => {
        onChange(api);
      }, [api, onChange]);
      return null;
    }

    const testRoot = createTestRoot();
    act(() => {
      testRoot.root.render(
        React.createElement(
          BrowserNodeProvider,
          { wsUrl: "ws://example.test/ws-1" },
          React.createElement(ApiCapture, { onChange: (api) => (capturedApi = api) }),
        ),
      );
    });

    try {
      await flushEffects();
      await flushEffects();

      await act(async () => {
        capturedApi.setCapabilityEnabled("geolocation.get", false);
        await Promise.resolve();
      });

      const result = await capturedApi.executeLocal({
        op: "geolocation.get",
        enable_high_accuracy: false,
        timeout_ms: 30_000,
        maximum_age_ms: 0,
      });

      expect(result).toEqual({
        success: false,
        error: "action 'geolocation.get' is disabled by the operator",
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("returns a clean error for unknown browser operations", async () => {
    const { BrowserNodeProvider, useBrowserNode } =
      await import("../../src/browser-node/browser-node-provider.js");

    stubLocalStorage({ "tyrum.operator-ui.browserNode.enabled": "1" });
    stubBrowserApis();

    let capturedApi: any = null;

    function ApiCapture({ onChange }: { onChange: (api: unknown) => void }) {
      const api = useBrowserNode();
      useEffect(() => {
        onChange(api);
      }, [api, onChange]);
      return null;
    }

    const testRoot = createTestRoot();
    act(() => {
      testRoot.root.render(
        React.createElement(
          BrowserNodeProvider,
          { wsUrl: "ws://example.test/ws-1" },
          React.createElement(ApiCapture, { onChange: (api) => (capturedApi = api) }),
        ),
      );
    });

    try {
      await flushEffects();
      await flushEffects();

      const result = await capturedApi.executeLocal({ op: "camera.snap" });

      expect(result).toMatchObject({ success: false });
      expect(result.error).toContain("invalid browser args:");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("cancels pending consent and persists disabled state", async () => {
    const { BrowserNodeProvider, useBrowserNode } =
      await import("../../src/browser-node/browser-node-provider.js");
    const { BrowserCapabilitiesPage } =
      await import("../../src/components/pages/platform/browser-capabilities-page.js");

    stubLocalStorage({ "tyrum.operator-ui.browserNode.enabled": "1" });
    stubBrowserApis();

    let capturedApi: any = null;

    function ApiCapture({ onChange }: { onChange: (api: unknown) => void }) {
      const api = useBrowserNode();
      useEffect(() => {
        onChange(api);
      }, [api, onChange]);
      return null;
    }

    const testRoot = createTestRoot();
    act(() => {
      testRoot.root.render(
        React.createElement(
          BrowserNodeProvider,
          { wsUrl: "ws://example.test/ws-1" },
          React.createElement(
            React.Fragment,
            null,
            React.createElement(ApiCapture, { onChange: (api) => (capturedApi = api) }),
            React.createElement(BrowserCapabilitiesPage),
          ),
        ),
      );
    });

    try {
      await flushEffects();
      await flushEffects();

      await clickButton("Get location");
      await flushEffects();

      expect(document.querySelector("[data-testid='browser-node-consent-dialog']")).not.toBeNull();

      await act(async () => {
        capturedApi.setEnabled(false);
        await Promise.resolve();
      });

      expect(globalThis.localStorage.getItem("tyrum.operator-ui.browserNode.enabled")).toBeNull();
      expect(document.querySelector("[data-testid='browser-node-consent-dialog']")).toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("clears the consent dialog when wsUrl changes", async () => {
    const { BrowserNodeProvider } = await import("../../src/browser-node/browser-node-provider.js");
    const { BrowserCapabilitiesPage } =
      await import("../../src/components/pages/platform/browser-capabilities-page.js");

    stubLocalStorage({ "tyrum.operator-ui.browserNode.enabled": "1" });
    stubBrowserApis();

    const testRoot = createTestRoot();

    act(() => {
      testRoot.root.render(
        React.createElement(
          BrowserNodeProvider,
          { wsUrl: "ws://example.test/ws-1" },
          React.createElement(BrowserCapabilitiesPage),
        ),
      );
    });

    try {
      await flushEffects();
      await flushEffects();

      await clickButton("Get location");
      await flushEffects();

      expect(document.querySelector("[data-testid='browser-node-consent-dialog']")).not.toBeNull();

      await act(async () => {
        testRoot.root.render(
          React.createElement(
            BrowserNodeProvider,
            { wsUrl: "ws://example.test/ws-2" },
            React.createElement(BrowserCapabilitiesPage),
          ),
        );
        await Promise.resolve();
      });

      expect(document.querySelector("[data-testid='browser-node-consent-dialog']")).toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("surfaces disconnect and transport errors through browser node state", async () => {
    const { BrowserNodeProvider, useBrowserNode } =
      await import("../../src/browser-node/browser-node-provider.js");

    stubLocalStorage({ "tyrum.operator-ui.browserNode.enabled": "1" });
    stubBrowserApis();

    let capturedApi: any = null;

    function ApiCapture({ onChange }: { onChange: (api: unknown) => void }) {
      const api = useBrowserNode();
      useEffect(() => {
        onChange(api);
      }, [api, onChange]);
      return null;
    }

    const testRoot = createTestRoot();
    act(() => {
      testRoot.root.render(
        React.createElement(
          BrowserNodeProvider,
          { wsUrl: "ws://example.test/ws-1" },
          React.createElement(ApiCapture, { onChange: (api) => (capturedApi = api) }),
        ),
      );
    });

    try {
      await flushEffects();
      await flushEffects();

      const client = clientInstances.at(0);
      expect(client).toBeDefined();
      expect(capturedApi.status).toBe("connected");

      await act(async () => {
        client?.emit("transport_error", { message: "network down" });
        await Promise.resolve();
      });

      expect(capturedApi.error).toBe("network down");
      expect(capturedApi.status).toBe("connected");

      await act(async () => {
        client?.emit("disconnected");
        await Promise.resolve();
      });

      expect(capturedApi.status).toBe("disconnected");
      expect(capturedApi.clientId).toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
