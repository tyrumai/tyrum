// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { readFileSync } from "node:fs";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import { ConnectPage } from "../../src/components/pages/connect-page.js";
import { cleanupTestRoot, renderIntoDocument, setNativeValue } from "../test-utils.js";

describe("ConnectPage", () => {
  it("avoids regex-based trailing slash trimming for ws URL derivation", () => {
    const source = readFileSync(
      "packages/operator-ui/src/components/pages/connect-page.tsx",
      "utf8",
    );
    expect(source).not.toContain('replace(/\\/+$/, "")');
  });

  it("normalizes gateway URLs before reconfiguring http and ws endpoints", async () => {
    const { store: connectionStore } = createStore({
      status: "disconnected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });

    const core = {
      connectionStore,
      httpBaseUrl: "https://gateway.example",
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as OperatorCore;

    const onReconfigureGateway = vi.fn();

    const testRoot = renderIntoDocument(
      React.createElement(ConnectPage, {
        core,
        mode: "desktop",
        onReconfigureGateway,
      }),
    );

    const gatewayInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="gateway-url"]',
    );
    expect(gatewayInput).not.toBeNull();

    act(() => {
      setNativeValue(gatewayInput as HTMLInputElement, "https://other-gateway.example///");
    });

    const loginButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="login-button"]',
    );
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onReconfigureGateway).toHaveBeenCalledTimes(1);
    expect(onReconfigureGateway).toHaveBeenCalledWith(
      "https://other-gateway.example",
      "wss://other-gateway.example/ws",
    );

    cleanupTestRoot(testRoot);
  });

  it("derives a valid ws URL when the gateway protocol casing is uppercase", async () => {
    const { store: connectionStore } = createStore({
      status: "disconnected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });

    const core = {
      connectionStore,
      httpBaseUrl: "https://gateway.example",
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as OperatorCore;

    const onReconfigureGateway = vi.fn();

    const testRoot = renderIntoDocument(
      React.createElement(ConnectPage, {
        core,
        mode: "desktop",
        onReconfigureGateway,
      }),
    );

    const gatewayInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="gateway-url"]',
    );
    expect(gatewayInput).not.toBeNull();

    act(() => {
      setNativeValue(gatewayInput as HTMLInputElement, "HTTPS://Uppercase.example///");
    });

    const loginButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="login-button"]',
    );
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onReconfigureGateway).toHaveBeenCalledTimes(1);
    expect(onReconfigureGateway).toHaveBeenCalledWith(
      "HTTPS://Uppercase.example",
      "wss://Uppercase.example/ws",
    );

    cleanupTestRoot(testRoot);
  });

  it("does not reconfigure when only trailing slashes differ", async () => {
    const { store: connectionStore } = createStore({
      status: "disconnected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });

    const core = {
      connectionStore,
      httpBaseUrl: "https://gateway.example",
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as OperatorCore;

    const onReconfigureGateway = vi.fn();

    const testRoot = renderIntoDocument(
      React.createElement(ConnectPage, {
        core,
        mode: "desktop",
        onReconfigureGateway,
      }),
    );

    const gatewayInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="gateway-url"]',
    );
    expect(gatewayInput).not.toBeNull();

    act(() => {
      setNativeValue(gatewayInput as HTMLInputElement, "https://gateway.example///");
    });

    const loginButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="login-button"]',
    );
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onReconfigureGateway).not.toHaveBeenCalled();
    expect(core.connect).toHaveBeenCalledTimes(1);

    cleanupTestRoot(testRoot);
  });

  it("shows connecting state and allows canceling the connection attempt", () => {
    const { store: connectionStore } = createStore({
      status: "connecting",
      recovering: false,
      nextRetryAtMs: null,
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });

    const core = {
      connectionStore,
      httpBaseUrl: "https://gateway.example",
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as OperatorCore;

    const testRoot = renderIntoDocument(
      React.createElement(ConnectPage, {
        core,
        mode: "desktop",
      }),
    );

    const loginButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="login-button"]',
    );
    expect(loginButton).not.toBeNull();
    expect(loginButton?.textContent).toContain("Connecting");
    expect(loginButton?.className).toContain("bg-primary");
    expect(loginButton?.getAttribute("aria-busy")).toBe("true");
    expect(loginButton?.disabled).toBe(true);

    const cancelButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="cancel-connect-button"]',
    );
    expect(cancelButton).not.toBeNull();

    act(() => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(core.disconnect).toHaveBeenCalledTimes(1);

    cleanupTestRoot(testRoot);
  });

  it("reconnects with saved token when readToken is not provided", async () => {
    const { store: connectionStore } = createStore({
      status: "disconnected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });

    const core = {
      connectionStore,
      httpBaseUrl: "https://gateway.example",
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as OperatorCore;

    const webAuthPersistence = {
      hasStoredToken: true,
      saveToken: vi.fn(),
      clearToken: vi.fn(),
    };

    const testRoot = renderIntoDocument(
      React.createElement(ConnectPage, {
        core,
        mode: "web",
        webAuthPersistence,
      }),
    );

    const loginButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="login-button"]',
    );
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(core.connect).toHaveBeenCalledTimes(1);

    cleanupTestRoot(testRoot);
  });

  it("reconnects with saved token when readToken returns null", async () => {
    const { store: connectionStore } = createStore({
      status: "disconnected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });

    const core = {
      connectionStore,
      httpBaseUrl: "https://gateway.example",
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as OperatorCore;

    const webAuthPersistence = {
      hasStoredToken: true,
      readToken: vi.fn().mockResolvedValue(null),
      saveToken: vi.fn(),
      clearToken: vi.fn(),
    };

    const testRoot = renderIntoDocument(
      React.createElement(ConnectPage, {
        core,
        mode: "web",
        webAuthPersistence,
      }),
    );

    // Wait for readToken to resolve
    await act(async () => {
      await Promise.resolve();
    });

    const loginButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="login-button"]',
    );
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(core.connect).toHaveBeenCalledTimes(1);

    cleanupTestRoot(testRoot);
  });

  it("handles synchronous throw from readToken gracefully", async () => {
    const { store: connectionStore } = createStore({
      status: "disconnected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });

    const core = {
      connectionStore,
      httpBaseUrl: "https://gateway.example",
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as OperatorCore;

    const webAuthPersistence = {
      hasStoredToken: true,
      readToken: () => {
        throw new Error("storage unavailable");
      },
      saveToken: vi.fn(),
      clearToken: vi.fn(),
    };

    const testRoot = renderIntoDocument(
      React.createElement(ConnectPage, {
        core,
        mode: "web",
        webAuthPersistence,
      }),
    );

    // Wait for the promise chain to settle after the synchronous throw
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const loginButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="login-button"]',
    );
    expect(loginButton).not.toBeNull();
    expect(loginButton?.disabled).toBe(false);

    cleanupTestRoot(testRoot);
  });

  it("shows a retry countdown while reconnect is scheduled from the background", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const baseNow = Date.now();

      const { store: connectionStore } = createStore({
        status: "disconnected",
        recovering: false,
        nextRetryAtMs: baseNow + 12_000,
        clientId: null,
        lastDisconnect: null,
        transportError: null,
      });

      const core = {
        connectionStore,
        httpBaseUrl: "https://gateway.example",
        connect: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as OperatorCore;

      const testRoot = renderIntoDocument(
        React.createElement(ConnectPage, {
          core,
          mode: "desktop",
        }),
      );

      const loginButton = testRoot.container.querySelector<HTMLButtonElement>(
        '[data-testid="login-button"]',
      );
      expect(loginButton).not.toBeNull();
      expect(loginButton?.className).toContain("bg-primary");
      expect(loginButton?.textContent).toContain("Connecting (12s)");

      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(loginButton?.textContent).toContain("Connecting (9s)");

      cleanupTestRoot(testRoot);
    } finally {
      vi.useRealTimers();
    }
  });
});
