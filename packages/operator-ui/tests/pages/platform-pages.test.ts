// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { DesktopApi } from "../../src/desktop-api.js";
import { BrowserNodeProvider } from "../../src/browser-node/browser-node-provider.js";
import { OperatorUiHostProvider } from "../../src/host/host-api.js";
import { NodeConfigurePage } from "../../src/components/pages/node-configure-page.js";
import { BrowserCapabilitiesPage } from "../../src/components/pages/platform/browser-capabilities-page.js";
import { cleanupTestRoot, renderIntoDocument, setNativeValue } from "../test-utils.js";

type HostValue =
  | {
      kind: "web";
    }
  | {
      kind: "desktop";
      api: DesktopApi | null;
    };

function renderWithHost(host: HostValue, element: React.ReactElement) {
  return renderIntoDocument(React.createElement(OperatorUiHostProvider, { value: host }, element));
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function clickTab(container: HTMLElement, label: string): void {
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((el) =>
    el.textContent?.includes(label),
  );
  expect(tab).not.toBeUndefined();
  tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
}

function clickButton(container: HTMLElement, label: string): void {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((el) =>
    el.textContent?.includes(label),
  );
  expect(button).not.toBeUndefined();
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function clickByTestId(container: HTMLElement, testId: string): void {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  expect(button).not.toBeNull();
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function getInputByLabel(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll<HTMLLabelElement>("label")).find((el) =>
    el.textContent?.includes(labelText),
  );
  expect(label).not.toBeUndefined();
  const id = label?.getAttribute("for");
  expect(id).toBeTruthy();
  const input = id ? container.querySelector<HTMLInputElement>(`input[id="${id}"]`) : null;
  expect(input).not.toBeNull();
  return input!;
}

function getTextareaByLabel(container: HTMLElement, labelText: string): HTMLTextAreaElement {
  const label = Array.from(container.querySelectorAll<HTMLLabelElement>("label")).find((el) =>
    el.textContent?.includes(labelText),
  );
  expect(label).not.toBeUndefined();
  const id = label?.getAttribute("for");
  expect(id).toBeTruthy();
  const textarea = id ? container.querySelector<HTMLTextAreaElement>(`textarea[id="${id}"]`) : null;
  expect(textarea).not.toBeNull();
  return textarea!;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Platform pages", () => {
  it("renders the browser capabilities page", () => {
    const storage = globalThis.localStorage;
    if (storage && typeof storage.removeItem === "function") {
      storage.removeItem("tyrum.operator-ui.browserNode.enabled");
    }
    const testRoot = renderIntoDocument(
      React.createElement(
        BrowserNodeProvider,
        { wsUrl: "ws://example.test/ws" },
        React.createElement(BrowserCapabilitiesPage),
      ),
    );
    try {
      expect(testRoot.container.textContent).toContain("Browser Capabilities");
      expect(testRoot.container.textContent).toContain("Browser node executor");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("shows node-configure fallback states for non-desktop and missing desktop api", () => {
    const webRoot = renderWithHost({ kind: "web" }, React.createElement(NodeConfigurePage));
    try {
      expect(webRoot.container.textContent).toContain(
        "Node configuration is only available in the desktop app.",
      );
    } finally {
      cleanupTestRoot(webRoot);
    }

    const missingApiRoot = renderWithHost(
      { kind: "desktop", api: null },
      React.createElement(NodeConfigurePage),
    );
    try {
      expect(missingApiRoot.container.textContent).toContain("Desktop API not available.");
    } finally {
      cleanupTestRoot(missingApiRoot);
    }
  });

  it("saves general node settings and requests a desktop rebootstrap when connection settings change", async () => {
    const setConfig = vi.fn(async () => {});
    const onReloadPage = vi.fn();
    const desktopApi = {
      getConfig: vi.fn(async () => ({
        mode: "embedded",
        embedded: { port: 8788 },
        remote: {
          wsUrl: "wss://saved.example/ws",
          tokenRef: "saved-token",
          tlsCertFingerprint256: "AA:BB",
          tlsAllowSelfSigned: false,
        },
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      })),
      setConfig,
      background: {
        getState: vi.fn(async () => ({
          enabled: false,
          supported: true,
          trayAvailable: true,
          loginAutoStartActive: false,
          mode: "embedded",
        })),
        setEnabled: vi.fn(async () => ({
          enabled: true,
          supported: true,
          trayAvailable: true,
          loginAutoStartActive: true,
          mode: "embedded",
        })),
      },
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
    } satisfies DesktopApi;

    const testRoot = renderWithHost(
      { kind: "desktop", api: desktopApi },
      React.createElement(NodeConfigurePage, { onReloadPage }),
    );
    try {
      await flushEffects();

      await act(async () => {
        clickButton(testRoot.container, "Remote");
        await Promise.resolve();
      });

      const wsUrlInput = getInputByLabel(testRoot.container, "Gateway WebSocket URL");
      const tokenInput = getInputByLabel(testRoot.container, "Token");
      const fingerprintInput = getInputByLabel(
        testRoot.container,
        "TLS certificate fingerprint (SHA-256, optional)",
      );

      act(() => {
        setNativeValue(wsUrlInput, "  wss://edge.example/ws  ");
        setNativeValue(tokenInput, "  top-secret-token  ");
        setNativeValue(fingerprintInput, "  AB:CD:EF  ");
      });

      await act(async () => {
        const tlsSwitch = Array.from(
          testRoot.container.querySelectorAll<HTMLButtonElement>('[role="switch"]'),
        )[0];
        expect(tlsSwitch).not.toBeUndefined();
        tlsSwitch?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      await act(async () => {
        clickByTestId(testRoot.container, "node-configure-save-general");
        await Promise.resolve();
      });

      expect(setConfig).toHaveBeenCalledTimes(1);
      expect(setConfig).toHaveBeenCalledWith({
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
        mode: "remote",
        remote: {
          wsUrl: "wss://edge.example/ws",
          tokenRef: "top-secret-token",
          tlsCertFingerprint256: "AB:CD:EF",
          tlsAllowSelfSigned: true,
        },
      });
      expect(desktopApi.node.disconnect).toHaveBeenCalledTimes(1);
      expect(desktopApi.gateway.stop).toHaveBeenCalledTimes(1);
      expect(onReloadPage).toHaveBeenCalledTimes(1);
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("clears general saved feedback after browser or shell edits", async () => {
    const setConfig = vi.fn(async () => {});
    const desktopApi = {
      getConfig: vi.fn(async () => ({
        mode: "embedded",
        embedded: { port: 8788 },
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      })),
      setConfig,
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
    } satisfies DesktopApi;

    const testRoot = renderWithHost(
      { kind: "desktop", api: desktopApi },
      React.createElement(NodeConfigurePage),
    );
    try {
      await flushEffects();

      const safeLabel = Array.from(testRoot.container.querySelectorAll("label")).find((el) =>
        el.textContent?.includes("Safe"),
      );
      expect(safeLabel).not.toBeUndefined();
      act(() => {
        safeLabel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      await act(async () => {
        clickByTestId(testRoot.container, "node-configure-save-general");
        await Promise.resolve();
      });

      const generalSaveButton = testRoot.container.querySelector<HTMLButtonElement>(
        '[data-testid="node-configure-save-general"]',
      );
      expect(generalSaveButton?.textContent).toContain("Saved!");

      await act(async () => {
        clickTab(testRoot.container, "Shell");
        await Promise.resolve();
      });

      const commandsTextarea = getTextareaByLabel(testRoot.container, "Allowed commands");
      act(() => {
        setNativeValue(commandsTextarea, "echo hello");
      });

      await act(async () => {
        clickTab(testRoot.container, "General");
        await Promise.resolve();
      });

      expect(
        testRoot.container.querySelector<HTMLButtonElement>(
          '[data-testid="node-configure-save-general"]',
        )?.textContent,
      ).toBe("Save General Settings");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("switches the displayed profile to custom after manual capability changes", async () => {
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
    } satisfies DesktopApi;

    const testRoot = renderWithHost(
      { kind: "desktop", api: desktopApi },
      React.createElement(NodeConfigurePage),
    );
    try {
      await flushEffects();

      const safeLabel = Array.from(testRoot.container.querySelectorAll("label")).find((el) =>
        el.textContent?.includes("Safe"),
      );
      expect(safeLabel).not.toBeUndefined();
      act(() => {
        safeLabel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      await act(async () => {
        clickTab(testRoot.container, "Browser");
        await Promise.resolve();
      });

      await act(async () => {
        clickByTestId(testRoot.container, "node-capability-browser");
        await Promise.resolve();
      });

      await act(async () => {
        clickTab(testRoot.container, "General");
        await Promise.resolve();
      });

      const customRadio = testRoot.container.querySelector<HTMLElement>("#node-profile-custom");
      expect(customRadio?.getAttribute("data-state")).toBe("checked");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("preserves trailing newlines while editing allowlists and trims them on save", async () => {
    const setConfig = vi.fn(async () => {});
    const desktopApi = {
      getConfig: vi.fn(async () => ({
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      })),
      setConfig,
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
    } satisfies DesktopApi;

    const testRoot = renderWithHost(
      { kind: "desktop", api: desktopApi },
      React.createElement(NodeConfigurePage),
    );
    try {
      await flushEffects();

      await act(async () => {
        clickTab(testRoot.container, "Shell");
        await Promise.resolve();
      });

      const commandsTextarea = getTextareaByLabel(testRoot.container, "Allowed commands");
      act(() => {
        setNativeValue(commandsTextarea, "git status\n");
      });

      expect(commandsTextarea.value).toBe("git status\n");

      await act(async () => {
        clickByTestId(testRoot.container, "node-configure-save-security");
        await Promise.resolve();
      });

      expect(setConfig).toHaveBeenCalledTimes(1);
      expect(setConfig).toHaveBeenCalledWith({
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: {
          allowedCommands: ["git status"],
          allowedWorkingDirs: [],
        },
        web: { allowedDomains: [], headless: true },
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("uses the loaded profile defaults when capabilities are missing from config", async () => {
    const desktopApi = {
      getConfig: vi.fn(async () => ({
        permissions: { profile: "balanced", overrides: {} },
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
    } satisfies DesktopApi;

    const testRoot = renderWithHost(
      { kind: "desktop", api: desktopApi },
      React.createElement(NodeConfigurePage),
    );
    try {
      await flushEffects();

      const balancedRadio = testRoot.container.querySelector<HTMLElement>("#node-profile-balanced");
      const customRadio = testRoot.container.querySelector<HTMLElement>("#node-profile-custom");

      expect(balancedRadio?.getAttribute("data-state")).toBe("checked");
      expect(customRadio?.getAttribute("data-state")).toBe("unchecked");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("clears general and security saved indicators independently", async () => {
    vi.useFakeTimers();

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
    } satisfies DesktopApi;

    const testRoot = renderWithHost(
      { kind: "desktop", api: desktopApi },
      React.createElement(NodeConfigurePage),
    );
    try {
      await flushEffects();

      const portInput = getInputByLabel(testRoot.container, "Embedded gateway port");
      act(() => {
        setNativeValue(portInput, "8789");
      });

      await act(async () => {
        clickByTestId(testRoot.container, "node-configure-save-general");
        await Promise.resolve();
      });

      expect(testRoot.container.textContent).toContain("Saved!");

      await act(async () => {
        clickTab(testRoot.container, "Browser");
        await Promise.resolve();
      });

      await act(async () => {
        clickByTestId(testRoot.container, "node-capability-browser");
        await Promise.resolve();
      });

      await act(async () => {
        clickByTestId(testRoot.container, "node-configure-save-security");
        await Promise.resolve();
      });

      expect(testRoot.container.textContent).toContain("Saved!");

      await act(async () => {
        vi.advanceTimersByTime(2_001);
        await Promise.resolve();
      });

      const securitySaveButton = testRoot.container.querySelector<HTMLButtonElement>(
        '[data-testid="node-configure-save-security"]',
      );
      expect(securitySaveButton?.textContent).toContain("Save Node Settings");

      await act(async () => {
        clickTab(testRoot.container, "General");
        await Promise.resolve();
      });

      const generalSaveButton = testRoot.container.querySelector<HTMLButtonElement>(
        '[data-testid="node-configure-save-general"]',
      );
      expect(generalSaveButton?.textContent).toContain("Save General Settings");
    } finally {
      cleanupTestRoot(testRoot);
      vi.useRealTimers();
    }
  });

  it("saves shell allowlist changes through node settings", async () => {
    const setConfig = vi.fn(async () => {});
    const desktopApi = {
      getConfig: vi.fn(async () => ({
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      })),
      setConfig,
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
    } satisfies DesktopApi;

    const testRoot = renderWithHost(
      { kind: "desktop", api: desktopApi },
      React.createElement(NodeConfigurePage),
    );
    try {
      await flushEffects();

      await act(async () => {
        clickTab(testRoot.container, "Shell");
        await Promise.resolve();
      });

      const commandsTextarea = getTextareaByLabel(testRoot.container, "Allowed commands");
      act(() => {
        setNativeValue(commandsTextarea, "git status\nnode --version");
      });

      await act(async () => {
        clickByTestId(testRoot.container, "node-configure-save-security");
        await Promise.resolve();
      });

      expect(setConfig).toHaveBeenCalledTimes(1);
      expect(setConfig).toHaveBeenCalledWith({
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: {
          allowedCommands: ["git status", "node --version"],
          allowedWorkingDirs: [],
        },
        web: { allowedDomains: [], headless: true },
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("keeps mac permission request errors visible", async () => {
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
    } satisfies DesktopApi;

    const testRoot = renderWithHost(
      { kind: "desktop", api: desktopApi },
      React.createElement(NodeConfigurePage),
    );
    try {
      await flushEffects();

      await act(async () => {
        clickTab(testRoot.container, "Desktop");
        await Promise.resolve();
      });

      await act(async () => {
        clickByTestId(testRoot.container, "node-request-accessibility");
        await Promise.resolve();
      });

      expect(desktopApi.requestMacPermission).toHaveBeenCalledTimes(1);
      expect(testRoot.container.textContent).toContain("Permission request failed.");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
