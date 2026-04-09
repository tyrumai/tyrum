// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserNodeProvider,
  type BrowserNodeApi,
} from "../../src/browser-node/browser-node-provider.js";
import { OperatorUiHostProvider } from "../../src/host/host-api.js";
import { NodeConfigPage } from "../../src/components/pages/node-config/node-config-page.js";
import {
  clickButtonAndFlush,
  clickSwitchAndFlush,
  createDesktopApi,
  createMobileHostApi,
  createNodeConfig,
  flushEffects,
  getInputByLabel,
  withBrowserCapabilitiesPage,
  withDesktopNodeConfigurePage,
  withHostNodeConfigurePage,
  withMobilePlatformPage,
} from "./platform-pages.test-support.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";
import { setNativeValue } from "../test-utils.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Platform pages browser and mobile flows", () => {
  it("renders the browser node config page", async () => {
    const storage = globalThis.localStorage;
    if (storage && typeof storage.removeItem === "function") {
      storage.removeItem("tyrum.operator-ui.browserNode.enabled");
    }

    await withBrowserCapabilitiesPage(({ container }) => {
      // The unified NodeConfigPage shows the browser executor toggle.
      expect(container.textContent).toContain("Browser node executor");
    });
  });

  it("renders browser capability sections on the config page", async () => {
    const storage = globalThis.localStorage;
    if (storage && typeof storage.removeItem === "function") {
      storage.removeItem("tyrum.operator-ui.browserNode.enabled");
      storage.removeItem("tyrum.operator-ui.browserNode.capabilities");
    }

    await withBrowserCapabilitiesPage(({ container }) => {
      // The unified NodeConfigPage lists capability sections.
      expect(container.textContent).toContain("Location");
      expect(container.textContent).toContain("Camera");
      expect(container.textContent).toContain("Audio");
    });
  });

  it("shows a warning when browser capabilities are blocked by secure-context requirements", () => {
    const value: BrowserNodeApi = {
      enabled: false,
      status: "disabled",
      deviceId: null,
      clientId: null,
      error: null,
      capabilityStates: {
        get: {
          supported: true,
          enabled: true,
          availability_status: "unavailable",
          unavailable_reason: "Geolocation requires a secure context and browser support.",
        },
        capture_photo: {
          supported: true,
          enabled: true,
          availability_status: "unavailable",
          unavailable_reason:
            "Camera capture requires a secure context and mediaDevices.getUserMedia.",
        },
        record: {
          supported: true,
          enabled: true,
          availability_status: "unavailable",
          unavailable_reason:
            "Microphone recording requires a secure context, mediaDevices.getUserMedia, and MediaRecorder.",
        },
      },
      setEnabled: vi.fn(),
      setCapabilityEnabled: vi.fn(),
      executeLocal: vi.fn(async () => ({ success: false })),
    };

    const testRoot = renderIntoDocument(
      React.createElement(
        BrowserNodeProvider,
        { value },
        React.createElement(
          OperatorUiHostProvider,
          { value: { kind: "web" as const } },
          React.createElement(NodeConfigPage),
        ),
      ),
    );

    try {
      expect(testRoot.container.textContent).toContain(
        "Trusted HTTPS is required for browser-node capabilities",
      );
      expect(testRoot.container.textContent).toContain(
        "it must be trusted by the browser or operating system",
      );
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("renders the mobile node config page and toggles a mobile action", async () => {
    const mobileHostApi = createMobileHostApi();

    await withMobilePlatformPage(mobileHostApi, async ({ container }) => {
      await flushEffects();

      // The unified NodeConfigPage shows the mobile executor with platform label.
      expect(container.textContent).toContain("iOS node executor");
      expect(container.textContent).toContain("iOS");
      expect(container.textContent).toContain("Location");

      await clickSwitchAndFlush(container, 1);

      expect(mobileHostApi.node.setActionEnabled).toHaveBeenCalledWith("get", false);
    });
  });

  it("shows desktop page fallback states for missing desktop api", async () => {
    await withHostNodeConfigurePage({ kind: "desktop", api: null }, ({ container }) => {
      expect(container.textContent).toContain("Desktop API not available.");
    });
  });

  it("saves connection settings and requests a desktop rebootstrap when connection settings change", async () => {
    const setConfig = vi.fn(async () => {});
    const onReloadPage = vi.fn();
    const desktopApi = createDesktopApi({
      config: createNodeConfig({
        remote: {
          wsUrl: "wss://saved.example/ws",
          tokenRef: "saved-token",
          tlsCertFingerprint256: "AA:BB",
        },
      }),
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
    });

    await withDesktopNodeConfigurePage(
      desktopApi,
      async ({ container }) => {
        await flushEffects();
        await clickButtonAndFlush(container, "Remote");

        const wsUrlInput = getInputByLabel(container, "Gateway WebSocket URL");
        const tokenInput = getInputByLabel(container, "Replace token");
        const fingerprintInput = getInputByLabel(
          container,
          "TLS certificate fingerprint (SHA-256, optional)",
        );

        act(() => {
          setNativeValue(wsUrlInput, "  wss://edge.example/ws  ");
          setNativeValue(tokenInput, "  top-secret-token  ");
          setNativeValue(fingerprintInput, "  AB:CD:EF  ");
        });

        await clickSwitchAndFlush(container, 0);
        await clickButtonAndFlush(container, "Save connection settings");

        expect(setConfig).toHaveBeenCalledTimes(1);
        expect(setConfig).toHaveBeenCalledWith({
          mode: "remote",
          remote: {
            wsUrl: "wss://edge.example/ws",
            tokenRef: "top-secret-token",
            tlsCertFingerprint256: "AB:CD:EF",
          },
        });
        expect(desktopApi.node.disconnect).toHaveBeenCalledTimes(1);
        expect(desktopApi.gateway.stop).toHaveBeenCalledTimes(1);
        expect(onReloadPage).toHaveBeenCalledTimes(1);
      },
      { onReloadPage },
    );
  });
});
