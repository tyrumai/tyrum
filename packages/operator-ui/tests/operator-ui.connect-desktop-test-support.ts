import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import { clickButtonByTestId, clickTabByLabel } from "./operator-ui.test-support.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

function registerConnectDesktopBasicTests(): void {
  it("connects via the primary connect action", () => {
    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    const connectButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="login-button"]',
    );
    expect(connectButton).not.toBeNull();

    act(() => {
      connectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(ws.connect).toHaveBeenCalledTimes(1);
    const connectingButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="login-button"]',
    );
    expect(connectingButton).not.toBeNull();
    expect(connectingButton?.textContent).toContain("Connecting");
    expect(connectingButton?.className).toContain("bg-primary");
    expect(connectingButton?.getAttribute("aria-busy")).toBe("true");

    const cancelButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="cancel-connect-button"]',
    );
    expect(cancelButton).not.toBeNull();
    act(() => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(ws.disconnect).toHaveBeenCalledTimes(1);

    expect(container.querySelector('[data-testid="disconnect-button"]')).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("routes desktop mode to node configuration and auto-connects the local node", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const desktopApi = {
      getConfig: vi.fn(async () => ({
        mode: "embedded",
        embedded: { port: 8788 },
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      })),
      setConfig: vi.fn(async () => {}),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "running", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connected" })),
        disconnect: vi.fn(async () => ({ status: "disconnected" })),
      },
      onStatusChange: vi.fn((_cb: (status: unknown) => void) => () => {}),
      checkMacPermissions: vi.fn(async () => null),
      requestMacPermission: vi.fn(async () => ({ granted: true })),
    };

    (window as unknown as Record<string, unknown>)["tyrumDesktop"] = desktopApi;

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(desktopApi.node.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      clickButtonByTestId(container, "nav-node-configure");
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Node Configuration");
    expect(container.querySelector('[data-testid="nav-node-configure"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="nav-desktop"]')).toBeNull();
    expect(container.querySelector('[data-testid="nav-connection"]')).toBeNull();

    act(() => {
      root?.unmount();
    });

    expect(desktopApi.node.disconnect).toHaveBeenCalledTimes(1);

    container.remove();
    delete (window as unknown as Record<string, unknown>)["tyrumDesktop"];
  });

  it("retries desktop node auto-connect after a raced connect resolves disconnected", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const desktopApi = {
      getConfig: vi.fn(async () => ({
        mode: "embedded",
        embedded: { port: 8788 },
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      })),
      setConfig: vi.fn(async () => {}),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "running", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi
          .fn(async () => ({ status: "connected" }))
          .mockResolvedValueOnce({ status: "disconnected" }),
        disconnect: vi.fn(async () => ({ status: "disconnected" })),
      },
      onStatusChange: vi.fn((_cb: (status: unknown) => void) => () => {}),
      checkMacPermissions: vi.fn(async () => null),
      requestMacPermission: vi.fn(async () => ({ granted: true })),
    };

    (window as unknown as Record<string, unknown>)["tyrumDesktop"] = desktopApi;

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(desktopApi.node.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      ws.emit("disconnected", { code: 1006, reason: "transport lost" });
      await Promise.resolve();
    });

    await act(async () => {
      ws.emit("connected", { clientId: null });
      await Promise.resolve();
    });

    expect(desktopApi.node.connect).toHaveBeenCalledTimes(2);
    expect(desktopApi.node.disconnect).toHaveBeenCalledTimes(0);

    act(() => {
      root?.unmount();
    });

    expect(desktopApi.node.disconnect).toHaveBeenCalledTimes(1);

    container.remove();
    delete (window as unknown as Record<string, unknown>)["tyrumDesktop"];
  });
}

function registerConnectDesktopSettingsTests(): void {
  it("disables node settings save while settings are saving", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    let resolveSetConfig: (() => void) | null = null;
    const setConfigPromise = new Promise<void>((resolve) => {
      resolveSetConfig = resolve;
    });

    const desktopApi = {
      getConfig: vi.fn(async () => ({
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      })),
      setConfig: vi.fn(async () => {
        await setConfigPromise;
      }),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "running", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connected" })),
        disconnect: vi.fn(async () => ({ status: "disconnected" })),
      },
      onStatusChange: vi.fn((_cb: (status: unknown) => void) => () => {}),
      checkMacPermissions: vi.fn(async () => null),
      requestMacPermission: vi.fn(async () => ({ granted: true })),
    };

    (window as unknown as Record<string, unknown>)["tyrumDesktop"] = desktopApi;

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    await act(async () => {
      clickButtonByTestId(container, "nav-node-configure");
      await Promise.resolve();
    });

    await act(async () => {
      clickTabByLabel(container, "Browser");
      await Promise.resolve();
    });

    await act(async () => {
      clickButtonByTestId(container, "node-capability-browser");
      await Promise.resolve();
    });

    const saveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="node-configure-save-security"]',
    );
    expect(saveButton).not.toBeNull();
    expect(saveButton!.disabled).toBe(false);

    await act(async () => {
      clickButtonByTestId(container, "node-configure-save-security");
      await Promise.resolve();
    });

    const updatedSaveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="node-configure-save-security"]',
    );
    expect(updatedSaveButton).not.toBeNull();
    expect(updatedSaveButton!.disabled).toBe(true);

    resolveSetConfig?.();
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      root?.unmount();
    });
    container.remove();
    delete (window as unknown as Record<string, unknown>)["tyrumDesktop"];
  });

  it("does not show saving status while requesting mac permissions", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    let resolvePermission: (() => void) | null = null;
    const permissionPromise = new Promise<void>((resolve) => {
      resolvePermission = resolve;
    });

    const desktopApi = {
      getConfig: vi.fn(async () => ({
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      })),
      setConfig: vi.fn(async () => {}),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "running", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connected" })),
        disconnect: vi.fn(async () => ({ status: "disconnected" })),
      },
      onStatusChange: vi.fn((_cb: (status: unknown) => void) => () => {}),
      checkMacPermissions: vi.fn(async () => null),
      requestMacPermission: vi.fn(async () => {
        await permissionPromise;
        return { granted: true };
      }),
    };

    (window as unknown as Record<string, unknown>)["tyrumDesktop"] = desktopApi;

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    await act(async () => {
      clickButtonByTestId(container, "nav-node-configure");
      await Promise.resolve();
    });

    await act(async () => {
      clickTabByLabel(container, "Desktop");
      await Promise.resolve();
    });

    const saveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="node-configure-save-security"]',
    );
    expect(saveButton).not.toBeNull();
    expect(saveButton!.textContent).toContain("Save Node Settings");

    const requestAccessibilityButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="node-request-accessibility"]',
    );
    expect(requestAccessibilityButton).not.toBeNull();

    await act(async () => {
      requestAccessibilityButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const updatedSaveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="node-configure-save-security"]',
    );
    expect(updatedSaveButton).not.toBeNull();
    expect(updatedSaveButton!.textContent).not.toContain("Saving...");

    resolvePermission?.();
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      root?.unmount();
    });
    container.remove();
    delete (window as unknown as Record<string, unknown>)["tyrumDesktop"];
  });

  it("keeps mac permission request errors visible in node configuration", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const desktopApi = {
      getConfig: vi.fn(async () => ({
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      })),
      setConfig: vi.fn(async () => {}),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "running", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connected" })),
        disconnect: vi.fn(async () => ({ status: "disconnected" })),
      },
      onStatusChange: vi.fn((_cb: (status: unknown) => void) => () => {}),
      checkMacPermissions: vi.fn(async () => null),
      requestMacPermission: vi.fn(async () => {
        throw new Error("Permission request failed.");
      }),
    };

    (window as unknown as Record<string, unknown>)["tyrumDesktop"] = desktopApi;

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    await act(async () => {
      clickButtonByTestId(container, "nav-node-configure");
      await Promise.resolve();
    });

    await act(async () => {
      clickTabByLabel(container, "Desktop");
      await Promise.resolve();
    });

    const requestAccessibilityButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="node-request-accessibility"]',
    );
    expect(requestAccessibilityButton).not.toBeNull();

    await act(async () => {
      requestAccessibilityButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(desktopApi.requestMacPermission).toHaveBeenCalledTimes(1);
    expect(desktopApi.checkMacPermissions).toHaveBeenCalledTimes(0);
    expect(container.textContent).toContain("Permission request failed.");

    act(() => {
      root?.unmount();
    });
    container.remove();
    delete (window as unknown as Record<string, unknown>)["tyrumDesktop"];
  });
}

export function registerConnectDesktopTests(): void {
  registerConnectDesktopBasicTests();
  registerConnectDesktopSettingsTests();
}
