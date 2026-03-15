// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clickButtonAndFlush,
  clickByTestIdAndFlush,
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
import { setNativeValue } from "../test-utils.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Platform pages browser and mobile flows", () => {
  it("renders the browser capabilities page", async () => {
    const storage = globalThis.localStorage;
    if (storage && typeof storage.removeItem === "function") {
      storage.removeItem("tyrum.operator-ui.browserNode.enabled");
    }

    await withBrowserCapabilitiesPage(({ container }) => {
      expect(container.textContent).toContain("Browser node executor");
      expect(container.textContent).toContain("Executor status");
    });
  });

  it("explains when capability toggles are configured but inactive because the executor is disabled", async () => {
    const storage = globalThis.localStorage;
    if (storage && typeof storage.removeItem === "function") {
      storage.removeItem("tyrum.operator-ui.browserNode.enabled");
      storage.removeItem("tyrum.operator-ui.browserNode.capabilities");
    }

    await withBrowserCapabilitiesPage(({ container }) => {
      expect(container.textContent).toContain("Configured enabled");
      expect(container.textContent).toContain("inactive until the browser executor is enabled");
      expect(container.textContent).toContain("Enable the browser executor to run tests");
    });
  });

  it("renders the mobile platform page and toggles a mobile action", async () => {
    const mobileHostApi = createMobileHostApi();

    await withMobilePlatformPage(mobileHostApi, async ({ container }) => {
      await flushEffects();

      expect(container.textContent).toContain("Mobile node executor");
      expect(container.textContent).toContain("iOS");
      expect(container.textContent).toContain("Location");

      await clickSwitchAndFlush(container, 1);

      expect(mobileHostApi.node.setActionEnabled).toHaveBeenCalledWith(
        "location.get_current",
        false,
      );
    });
  });

  it("shows desktop page fallback states for non-desktop and missing desktop api", async () => {
    await withHostNodeConfigurePage({ kind: "web" }, ({ container }) => {
      expect(container.textContent).toContain(
        "Node configuration is only available in the desktop app.",
      );
    });

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
          tlsAllowSelfSigned: false,
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
        await clickByTestIdAndFlush(container, "node-configure-save-connection");

        expect(setConfig).toHaveBeenCalledTimes(1);
        expect(setConfig).toHaveBeenCalledWith({
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
      },
      { onReloadPage },
    );
  });
});
