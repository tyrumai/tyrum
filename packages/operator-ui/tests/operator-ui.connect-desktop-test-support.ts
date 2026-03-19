import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-app/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import { OperatorUiHostProvider } from "../src/host/host-api.js";
import { clickButtonByTestId } from "./operator-ui.test-support.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

/**
 * Find the Expand button inside a capability card identified by its label.
 * The capability has a Switch with aria-label="Toggle <capabilityLabel>".
 * The expand button is in the same card with aria-label="Expand".
 */
function findExpandButtonForCapability(
  container: HTMLElement,
  capabilityLabel: string,
): HTMLButtonElement | null {
  const capSwitch = container.querySelector<HTMLButtonElement>(
    `[role="switch"][aria-label="Toggle ${capabilityLabel}"]`,
  );
  if (!capSwitch) return null;
  // Walk up to the card boundary. The card is rendered with a Card component
  // that creates a div. Walk up several levels to find the expand button sibling.
  let node: HTMLElement | null = capSwitch;
  for (let i = 0; i < 10; i++) {
    node = node?.parentElement ?? null;
    if (!node) return null;
    const expandBtn = node.querySelector<HTMLButtonElement>('[aria-label="Expand"]');
    if (expandBtn) return expandBtn;
  }
  return null;
}

function renderDesktopOperatorUi(
  container: HTMLElement,
  core: ReturnType<typeof createOperatorCore>,
  desktopApi: unknown,
): Root {
  const root = createRoot(container);
  root.render(
    React.createElement(
      OperatorUiHostProvider,
      { value: { kind: "desktop", api: desktopApi } },
      React.createElement(OperatorUiApp, { core, mode: "desktop" }),
    ),
  );
  return root;
}

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

  it("routes desktop mode to the desktop page and auto-connects the local node", async () => {
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
      root = renderDesktopOperatorUi(container, core, desktopApi);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(desktopApi.node.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      clickButtonByTestId(container, "nav-desktop");
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Desktop");
    expect(container.querySelector('[data-testid="nav-desktop"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="nav-node-configure"]')).toBeNull();
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
      root = renderDesktopOperatorUi(container, core, desktopApi);
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
  it("auto-saves when toggling a capability on the desktop page", async () => {
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
      requestMacPermission: vi.fn(async () => ({ granted: true })),
    };

    (window as unknown as Record<string, unknown>)["tyrumDesktop"] = desktopApi;

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = renderDesktopOperatorUi(container, core, desktopApi);
    });

    await act(async () => {
      clickButtonByTestId(container, "nav-desktop");
      await Promise.resolve();
    });

    // Wait for config to load.
    await act(async () => {
      await Promise.resolve();
    });

    // In the new unified page, all capabilities are visible (no tabs).
    // Toggle "Browser Automation" switch to trigger auto-save.
    const browserSwitch = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Toggle Browser Automation"]',
    );
    expect(browserSwitch).not.toBeNull();

    await act(async () => {
      browserSwitch?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    // Auto-save should have called setConfig.
    expect(desktopApi.setConfig).toHaveBeenCalled();

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
      root = renderDesktopOperatorUi(container, core, desktopApi);
    });

    await act(async () => {
      clickButtonByTestId(container, "nav-desktop");
      await Promise.resolve();
    });

    // Wait for config to load.
    await act(async () => {
      await Promise.resolve();
    });

    // In the new unified page, expand Desktop Automation card to see macOS permissions.
    const expandButton = findExpandButtonForCapability(container, "Desktop Automation");
    expect(expandButton).not.toBeNull();

    await act(async () => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    // Find "Request Accessibility" button by text.
    const requestAccessibilityButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((el) => el.textContent?.includes("Request Accessibility"));
    expect(requestAccessibilityButton).not.toBeUndefined();

    await act(async () => {
      requestAccessibilityButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    // The auto-save status should NOT show "Saving..." from a permission request.
    expect(container.textContent).not.toContain("Saving\u2026");

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

  it("keeps mac permission request errors visible on the desktop page", async () => {
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
      root = renderDesktopOperatorUi(container, core, desktopApi);
    });

    await act(async () => {
      clickButtonByTestId(container, "nav-desktop");
      await Promise.resolve();
    });

    // Wait for config to load.
    await act(async () => {
      await Promise.resolve();
    });

    // Expand Desktop Automation card to see macOS permissions.
    const expandButton = findExpandButtonForCapability(container, "Desktop Automation");
    expect(expandButton).not.toBeNull();

    await act(async () => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    // Find "Request Accessibility" button by text.
    const requestAccessibilityButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((el) => el.textContent?.includes("Request Accessibility"));
    expect(requestAccessibilityButton).not.toBeUndefined();

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
