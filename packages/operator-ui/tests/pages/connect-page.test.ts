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
});
