// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, useEffect } from "react";
import { cleanupTestRoot, createTestRoot } from "../test-utils.js";

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

  #emit(event: string, evt?: unknown): void {
    const set = this.#handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      handler(evt);
    }
  }
}

vi.mock("@tyrum/client", () => ({
  autoExecute: vi.fn(),
  createBrowserLocalStorageDeviceIdentityStorage: vi.fn((_key: string) => ({})),
  formatDeviceIdentityError: vi.fn((err: unknown) => String(err)),
  loadOrCreateDeviceIdentity: vi.fn(async () => ({
    deviceId: "device-1",
    publicKey: "pub-1",
    privateKey: "priv-1",
  })),
  TyrumClient: FakeTyrumClient,
}));

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

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function clickButton(label: string): void {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((el) =>
    el.textContent?.includes(label),
  );
  expect(button).not.toBeUndefined();
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BrowserNodeProvider", () => {
  it("cancels pending consent and persists disabled state", async () => {
    const { BrowserNodeProvider, useBrowserNode } =
      await import("../../src/browser-node/browser-node-provider.js");
    const { BrowserCapabilitiesPage } =
      await import("../../src/components/pages/platform/browser-capabilities-page.js");

    stubLocalStorage({ "tyrum.operator-ui.browserNode.enabled": "1" });

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

      clickButton("Get location");
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

      clickButton("Get location");
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
});
