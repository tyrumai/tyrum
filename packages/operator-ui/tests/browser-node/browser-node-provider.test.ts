// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, useEffect } from "react";
import { cleanupTestRoot, createTestRoot } from "../test-utils.js";
import { createManagedNodeClientLifecycleMock } from "../../../client/tests/managed-node-client.test-support.js";

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
    createManagedNodeClientLifecycle: createManagedNodeClientLifecycleMock({
      autoExecute,
      requireConnectedObject: true,
    }),
  };
});

vi.mock("@tyrum/operator-core/browser", () => {
  return {
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
        capturedApi.setCapabilityEnabled("get", false);
        await Promise.resolve();
      });

      const result = await capturedApi.executeLocal({
        op: "get",
        enable_high_accuracy: false,
        timeout_ms: 30_000,
        maximum_age_ms: 0,
      });

      expect(result).toEqual({
        success: false,
        error: "action 'get' is disabled by the operator",
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

      // Trigger the consent dialog by calling executeLocal directly.
      await act(async () => {
        void capturedApi.executeLocal({
          op: "get",
          enable_high_accuracy: false,
          timeout_ms: 30_000,
          maximum_age_ms: 0,
        });
        await Promise.resolve();
      });
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

  it("shows a distinct effective capability description when the executor is active", async () => {
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

      // When the executor is active and capabilities are enabled,
      // the capability status should be "available" (not "unavailable").
      expect(capturedApi).not.toBeNull();
      expect(capturedApi.enabled).toBe(true);
      expect(capturedApi.status).toBe("connected");

      const states = capturedApi.capabilityStates;
      expect(states["get"].availability_status).toBe("available");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("clears the consent dialog when wsUrl changes", async () => {
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

      // Trigger the consent dialog by calling executeLocal directly.
      await act(async () => {
        void capturedApi.executeLocal({
          op: "get",
          enable_high_accuracy: false,
          timeout_ms: 30_000,
          maximum_age_ms: 0,
        });
        await Promise.resolve();
      });
      await flushEffects();

      expect(document.querySelector("[data-testid='browser-node-consent-dialog']")).not.toBeNull();

      await act(async () => {
        testRoot.root.render(
          React.createElement(
            BrowserNodeProvider,
            { wsUrl: "ws://example.test/ws-2" },
            React.createElement(ApiCapture, { onChange: (api) => (capturedApi = api) }),
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
