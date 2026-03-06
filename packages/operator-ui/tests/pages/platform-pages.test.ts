// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import type { DesktopApi } from "../../src/desktop-api.js";
import { OperatorUiHostProvider } from "../../src/host/host-api.js";
import { BrowserNodeProvider } from "../../src/browser-node/browser-node-provider.js";
import { BrowserCapabilitiesPage } from "../../src/components/pages/platform/browser-capabilities-page.js";
import { PlatformConnectionPage } from "../../src/components/pages/platform/connection-page.js";
import { PlatformDebugPage } from "../../src/components/pages/platform/debug-page.js";
import { PlatformDiagnosticsPanel } from "../../src/components/pages/platform/diagnostics.js";
import { PlatformLogsPanel } from "../../src/components/pages/platform/logs.js";
import { PlatformPermissionsPage } from "../../src/components/pages/platform/permissions-page.js";
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

  it("renders debug tabs and switches from logs to diagnostics", async () => {
    const testRoot = renderWithHost({ kind: "web" }, React.createElement(PlatformDebugPage));
    try {
      expect(testRoot.container.textContent).toContain("Debug");
      expect(testRoot.container.textContent).toContain(
        "Logs are only available in the desktop app.",
      );

      await act(async () => {
        clickTab(testRoot.container, "Diagnostics");
        await Promise.resolve();
      });

      expect(testRoot.container.textContent).toContain(
        "Diagnostics are only available in the desktop app.",
      );
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("shows connection-page fallback states for non-desktop and missing desktop api", () => {
    const webRoot = renderWithHost(
      { kind: "web" },
      React.createElement(PlatformConnectionPage, { core: {} as OperatorCore }),
    );
    try {
      expect(webRoot.container.textContent).toContain(
        "Platform connection controls are only available in the desktop app.",
      );
    } finally {
      cleanupTestRoot(webRoot);
    }

    const missingApiRoot = renderWithHost(
      { kind: "desktop", api: null },
      React.createElement(PlatformConnectionPage, { core: {} as OperatorCore }),
    );
    try {
      expect(missingApiRoot.container.textContent).toContain("Desktop API not available.");
    } finally {
      cleanupTestRoot(missingApiRoot);
    }
  });

  it("runs embedded and remote connection actions through desktop api", async () => {
    const statusListeners: Array<(status: unknown) => void> = [];
    const desktopApi = {
      getConfig: vi.fn(async () => ({
        mode: "remote",
        embedded: { port: 9001 },
        remote: {
          wsUrl: "wss://saved.example/ws",
          tokenRef: "saved-token",
          tlsCertFingerprint256: "AA:BB",
          tlsAllowSelfSigned: false,
        },
      })),
      setConfig: vi.fn(async () => {}),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "stopped", port: 9001 })),
        start: vi.fn(async () => ({ status: "running", port: 9001 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connected" })),
        disconnect: vi.fn(async () => ({ status: "disconnected" })),
      },
      onStatusChange: vi.fn((cb: (status: unknown) => void) => {
        statusListeners.push(cb);
        return () => {};
      }),
    } satisfies DesktopApi;

    const testRoot = renderWithHost(
      { kind: "desktop", api: desktopApi },
      React.createElement(PlatformConnectionPage, { core: {} as OperatorCore }),
    );

    try {
      await flushEffects();
      expect(testRoot.container.textContent).toContain(
        "A token is already saved. Leave blank to reuse it, or enter a new token to replace it.",
      );

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
        clickButton(testRoot.container, "Connect");
        await Promise.resolve();
      });

      expect(desktopApi.node.connect).toHaveBeenCalledTimes(1);
      expect(desktopApi.setConfig).toHaveBeenCalledWith({
        mode: "remote",
        remote: {
          wsUrl: "  wss://edge.example/ws  ",
          tokenRef: "top-secret-token",
          tlsCertFingerprint256: "AB:CD:EF",
          tlsAllowSelfSigned: false,
        },
      });
      expect(testRoot.container.textContent).toContain("Disconnect");

      await act(async () => {
        clickButton(testRoot.container, "Disconnect");
        await Promise.resolve();
      });
      expect(desktopApi.node.disconnect).toHaveBeenCalledTimes(1);

      await act(async () => {
        clickTab(testRoot.container, "Embedded");
        await Promise.resolve();
      });

      await act(async () => {
        clickButton(testRoot.container, "Start Gateway");
        await Promise.resolve();
      });
      expect(desktopApi.gateway.start).toHaveBeenCalledTimes(1);
      expect(desktopApi.setConfig).toHaveBeenCalledWith({
        mode: "embedded",
        embedded: { port: 9001 },
      });

      await act(async () => {
        clickButton(testRoot.container, "Stop Gateway");
        await Promise.resolve();
      });
      expect(desktopApi.gateway.stop).toHaveBeenCalledTimes(1);

      act(() => {
        statusListeners[0]?.({ gatewayStatus: "running", nodeStatus: "connected", port: 9010 });
      });
      expect(testRoot.container.textContent).toContain("Status: running");
      await act(async () => {
        clickTab(testRoot.container, "Remote");
        await Promise.resolve();
      });
      expect(testRoot.container.textContent).toContain("Node status: connected");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("toggles background mode through the desktop api", async () => {
    const desktopApi = {
      getConfig: vi.fn(async () => ({ mode: "embedded", embedded: { port: 8788 } })),
      setConfig: vi.fn(async () => {}),
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
        getStatus: vi.fn(async () => ({ status: "stopped", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connected" })),
        disconnect: vi.fn(async () => ({ status: "disconnected" })),
      },
      onStatusChange: vi.fn(() => () => {}),
    } satisfies DesktopApi;

    const testRoot = renderWithHost(
      { kind: "desktop", api: desktopApi },
      React.createElement(PlatformConnectionPage, { core: {} as OperatorCore }),
    );

    try {
      await flushEffects();
      expect(testRoot.container.textContent).toContain("Background mode");

      const toggle = testRoot.container.querySelector<HTMLButtonElement>('[role="switch"]');
      expect(toggle).not.toBeNull();

      await act(async () => {
        toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(desktopApi.background.setEnabled).toHaveBeenCalledWith(true);
      expect(testRoot.container.textContent).toContain("Launch at login is active.");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("shows gateway errors when starting embedded mode fails", async () => {
    const desktopApi = {
      getConfig: vi.fn(async () => ({ mode: "embedded", embedded: { port: 8788 } })),
      setConfig: vi.fn(async () => {}),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "stopped", port: 8788 })),
        start: vi.fn(async () => {
          throw new Error("start failed");
        }),
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
      React.createElement(PlatformConnectionPage, { core: {} as OperatorCore }),
    );
    try {
      await flushEffects();
      await act(async () => {
        clickButton(testRoot.container, "Start Gateway");
        await Promise.resolve();
      });

      expect(testRoot.container.textContent).toContain("Gateway error");
      expect(testRoot.container.textContent).toContain("start failed");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("shows permission-page fallback states for non-desktop and missing desktop api", () => {
    const webRoot = renderWithHost({ kind: "web" }, React.createElement(PlatformPermissionsPage));
    try {
      expect(webRoot.container.textContent).toContain(
        "Platform permission controls are only available in the desktop app.",
      );
    } finally {
      cleanupTestRoot(webRoot);
    }

    const missingApiRoot = renderWithHost(
      { kind: "desktop", api: null },
      React.createElement(PlatformPermissionsPage),
    );
    try {
      expect(missingApiRoot.container.textContent).toContain("Desktop API not available.");
    } finally {
      cleanupTestRoot(missingApiRoot);
    }
  });

  it("loads, edits, and saves platform permission settings", async () => {
    const setConfig = vi.fn(async () => {});
    const desktopApi = {
      getConfig: vi.fn(async () => ({
        permissions: { profile: "balanced" },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      })),
      setConfig,
      gateway: {
        getStatus: vi.fn(async () => ({ status: "stopped", port: 8788 })),
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
      React.createElement(PlatformPermissionsPage),
    );
    try {
      await flushEffects();
      expect(testRoot.container.textContent).toContain("CLI allowlist is active and empty");
      expect(testRoot.container.textContent).toContain("Domain allowlist is active and empty");

      const safeLabel = Array.from(testRoot.container.querySelectorAll("label")).find((el) =>
        el.textContent?.includes("Safe"),
      );
      expect(safeLabel).not.toBeUndefined();
      act(() => {
        safeLabel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      await act(async () => {
        clickButton(testRoot.container, "Save Permissions");
        await Promise.resolve();
      });

      expect(desktopApi.setConfig).toHaveBeenCalledTimes(1);
      const firstPayload = desktopApi.setConfig.mock.calls[0]?.[0] as any;
      expect(firstPayload.permissions.profile).toBe("safe");
      expect(firstPayload.capabilities).toEqual({
        desktop: true,
        playwright: false,
        cli: false,
        http: false,
      });

      setConfig.mockRejectedValueOnce(new Error("persist failed"));
      await act(async () => {
        clickButton(testRoot.container, "Save");
        await Promise.resolve();
      });
      expect(testRoot.container.textContent).toContain("Save failed");
      expect(testRoot.container.textContent).toContain("persist failed");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("keeps restrictive fallback capabilities when config omits capabilities", async () => {
    const setConfig = vi.fn(async () => {});
    const desktopApi = {
      getConfig: vi.fn(async () => ({
        permissions: { profile: "balanced" },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      })),
      setConfig,
      gateway: {
        getStatus: vi.fn(async () => ({ status: "stopped", port: 8788 })),
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
      React.createElement(PlatformPermissionsPage),
    );
    try {
      await flushEffects();
      expect(testRoot.container.textContent).not.toContain("CLI allowlist is active and empty");
      expect(testRoot.container.textContent).not.toContain("Domain allowlist is active and empty");

      await act(async () => {
        clickButton(testRoot.container, "Save Permissions");
        await Promise.resolve();
      });

      expect(desktopApi.setConfig).toHaveBeenCalledTimes(1);
      expect(desktopApi.setConfig.mock.calls[0]?.[0]).toMatchObject({
        permissions: { profile: "balanced" },
        capabilities: {
          desktop: true,
          playwright: false,
          cli: false,
          http: false,
        },
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("shows log-panel fallback states for non-desktop, missing api, and missing stream", () => {
    const webRoot = renderWithHost({ kind: "web" }, React.createElement(PlatformLogsPanel));
    try {
      expect(webRoot.container.textContent).toContain(
        "Logs are only available in the desktop app.",
      );
    } finally {
      cleanupTestRoot(webRoot);
    }

    const missingApiRoot = renderWithHost(
      { kind: "desktop", api: null },
      React.createElement(PlatformLogsPanel),
    );
    try {
      expect(missingApiRoot.container.textContent).toContain("Desktop API not available.");
    } finally {
      cleanupTestRoot(missingApiRoot);
    }

    const noStreamApi = {
      getConfig: vi.fn(async () => ({})),
      setConfig: vi.fn(async () => ({})),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "stopped", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connected" })),
        disconnect: vi.fn(async () => ({ status: "disconnected" })),
      },
      onStatusChange: vi.fn((_cb: (status: unknown) => void) => () => {}),
    } satisfies DesktopApi;
    const noStreamRoot = renderWithHost(
      { kind: "desktop", api: noStreamApi },
      React.createElement(PlatformLogsPanel),
    );
    try {
      expect(noStreamRoot.container.textContent).toContain(
        "This desktop build does not expose log streaming.",
      );
    } finally {
      cleanupTestRoot(noStreamRoot);
    }
  });

  it("renders desktop logs, filters by tab, and clears entries", async () => {
    let logListener: ((entry: unknown) => void) | null = null;
    const desktopApi = {
      getConfig: vi.fn(async () => ({})),
      setConfig: vi.fn(async () => ({})),
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
      onLog: vi.fn((cb: (entry: unknown) => void) => {
        logListener = cb;
        return () => {};
      }),
    } satisfies DesktopApi;

    const testRoot = renderWithHost(
      { kind: "desktop", api: desktopApi },
      React.createElement(PlatformLogsPanel),
    );
    try {
      expect(testRoot.container.textContent).toContain("No log entries yet");

      act(() => {
        logListener?.({
          timestamp: "2026-01-01T00:00:00.000Z",
          level: "info",
          source: "gateway",
          message: "gateway ready",
        });
        logListener?.({
          timestamp: "2026-01-01T00:00:01.000Z",
          level: "warn",
          source: "node",
          message: "node warning",
        });
      });

      expect(testRoot.container.textContent).toContain("gateway ready");

      await act(async () => {
        clickTab(testRoot.container, "Node");
        await Promise.resolve();
      });
      expect(testRoot.container.textContent).toContain("node warning");

      act(() => {
        clickButton(testRoot.container, "Clear");
      });
      expect(testRoot.container.textContent).toContain("No log entries yet");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("shows diagnostics fallback states for non-desktop and missing desktop api", () => {
    const webRoot = renderWithHost({ kind: "web" }, React.createElement(PlatformDiagnosticsPanel));
    try {
      expect(webRoot.container.textContent).toContain(
        "Diagnostics are only available in the desktop app.",
      );
    } finally {
      cleanupTestRoot(webRoot);
    }

    const missingApiRoot = renderWithHost(
      { kind: "desktop", api: null },
      React.createElement(PlatformDiagnosticsPanel),
    );
    try {
      expect(missingApiRoot.container.textContent).toContain("Desktop API not available.");
    } finally {
      cleanupTestRoot(missingApiRoot);
    }
  });

  it("handles unavailable permission-request API in diagnostics panel", async () => {
    const desktopApi = {
      getConfig: vi.fn(async () => ({ mode: "embedded" })),
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
    } satisfies DesktopApi;

    const testRoot = renderWithHost(
      { kind: "desktop", api: desktopApi },
      React.createElement(PlatformDiagnosticsPanel),
    );
    try {
      await flushEffects();
      act(() => {
        clickButton(testRoot.container, "Request Accessibility");
      });
      expect(testRoot.container.textContent).toContain(
        "Permission requests are not available in this build.",
      );
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("runs diagnostics checks, permission requests, and desktop update actions", async () => {
    let updateStateListener: ((state: unknown) => void) | null = null;
    const baseUpdateState = {
      stage: "idle",
      currentVersion: "1.0.0",
      availableVersion: null,
      downloadedVersion: null,
      releaseDate: null,
      releaseNotes: null,
      progressPercent: null,
      message: null,
      checkedAt: null,
    };

    const desktopApi = {
      getConfig: vi.fn(async () => ({ mode: "embedded" })),
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
      checkMacPermissions: vi.fn(async () => ({
        accessibility: false,
        screenRecording: true,
        instructions: "Open Settings",
      })),
      requestMacPermission: vi.fn(async () => ({
        granted: false,
        instructions: "Open Settings",
      })),
      updates: {
        getState: vi.fn(async () => baseUpdateState),
        check: vi.fn(async () => ({
          ...baseUpdateState,
          stage: "available",
          availableVersion: "1.1.0",
        })),
        download: vi.fn(async () => ({
          ...baseUpdateState,
          stage: "downloading",
          progressPercent: 25,
        })),
        install: vi.fn(async () => ({
          ...baseUpdateState,
          stage: "installing",
        })),
        openReleaseFile: vi.fn(async () => ({
          opened: true,
          path: "/tmp/release.zip",
          message: null,
        })),
      },
      onUpdateStateChange: vi.fn((cb: (state: unknown) => void) => {
        updateStateListener = cb;
        return () => {};
      }),
    } satisfies DesktopApi;

    const testRoot = renderWithHost(
      { kind: "desktop", api: desktopApi },
      React.createElement(PlatformDiagnosticsPanel),
    );
    try {
      await flushEffects();
      expect(testRoot.container.textContent).toContain("Missing: Accessibility");

      await act(async () => {
        clickButton(testRoot.container, "Request Accessibility");
        await Promise.resolve();
      });
      expect(desktopApi.requestMacPermission).toHaveBeenCalledWith("accessibility");
      expect(testRoot.container.textContent).toContain("Open Settings");

      await act(async () => {
        clickButton(testRoot.container, "Check for Updates");
        await Promise.resolve();
      });
      expect(desktopApi.updates?.check).toHaveBeenCalledTimes(1);
      expect(testRoot.container.textContent).toContain("Update check started.");

      await act(async () => {
        clickButton(testRoot.container, "Download Update");
        await Promise.resolve();
      });
      expect(desktopApi.updates?.download).toHaveBeenCalledTimes(1);

      act(() => {
        updateStateListener?.({
          ...baseUpdateState,
          stage: "downloaded",
          downloadedVersion: "1.1.0",
        });
      });

      await act(async () => {
        clickButton(testRoot.container, "Install Update");
        await Promise.resolve();
      });
      expect(desktopApi.updates?.install).toHaveBeenCalledTimes(1);

      await act(async () => {
        clickButton(testRoot.container, "Use Local Release File");
        await Promise.resolve();
      });
      expect(desktopApi.updates?.openReleaseFile).toHaveBeenCalledTimes(1);
      expect(testRoot.container.textContent).toContain("Installer opened.");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
