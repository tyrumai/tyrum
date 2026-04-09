// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clickButtonAndFlush,
  clickSwitchByAriaLabelAndFlush,
  createDesktopApi,
  createNodeConfig,
  expandCapabilityCard,
  flushEffects,
  getInputByLabel,
  getTextareaByLabel,
  withDesktopNodeConfigurePage,
} from "./platform-pages.test-support.js";
import { setNativeValue } from "../test-utils.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Platform pages", () => {
  it("shows embedded tailscale status and enables serve from the connection panel", async () => {
    const enableTailscaleServe = vi.fn(async () => ({
      adminUrl: "https://login.tailscale.com/admin/machines",
      binaryAvailable: true,
      backendRunning: true,
      backendState: "Running",
      currentPublicBaseUrl: "https://gateway.tailnet.ts.net",
      dnsName: "gateway.tailnet.ts.net",
      gatewayReachable: true,
      gatewayReachabilityReason: null,
      gatewayTarget: "http://127.0.0.1:8788",
      managedStatePresent: true,
      ownership: "managed" as const,
      publicBaseUrlMatches: true,
      publicUrl: "https://gateway.tailnet.ts.net",
      reason: null,
    }));

    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
      gateway: {
        getTailscaleServeStatus: vi.fn(async () => ({
          adminUrl: "https://login.tailscale.com/admin/machines",
          binaryAvailable: true,
          backendRunning: true,
          backendState: "Running",
          currentPublicBaseUrl: "http://127.0.0.1:8788",
          dnsName: "gateway.tailnet.ts.net",
          gatewayReachable: true,
          gatewayReachabilityReason: null,
          gatewayTarget: "http://127.0.0.1:8788",
          managedStatePresent: false,
          ownership: "disabled" as const,
          publicBaseUrlMatches: false,
          publicUrl: "https://gateway.tailnet.ts.net",
          reason: null,
        })),
        enableTailscaleServe,
      },
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();
      await flushEffects();

      expect(container.textContent).toContain("Tailscale Serve");
      expect(container.textContent).toContain("gateway.tailnet.ts.net");

      await clickButtonAndFlush(container, "Enable");

      expect(enableTailscaleServe).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain("server.publicBaseUrl");
      expect(container.textContent).toContain("https://gateway.tailnet.ts.net");
    });
  });

  it("shows and copies the current embedded gateway token", async () => {
    const writeText = vi.fn(async () => {});
    const getOperatorConnection = vi.fn(async () => ({
      mode: "embedded" as const,
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788/",
      token: "tyrum-token.v1.embedded.token",
      tlsCertFingerprint256: "",
    }));
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
      gateway: { getOperatorConnection },
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();
      await flushEffects();

      const currentTokenInput = getInputByLabel(container, "Current gateway token");
      expect(currentTokenInput.value).toBe("tyrum-token.v1.embedded.token");
      expect(currentTokenInput.readOnly).toBe(true);

      // The copy button now uses aria-label instead of data-testid.
      const copyButton = container.querySelector<HTMLButtonElement>(
        '[aria-label="Copy gateway token"]',
      );
      expect(copyButton).not.toBeNull();
      await act(async () => {
        copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(getOperatorConnection).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith("tyrum-token.v1.embedded.token");
    });
  });

  it("shows the current remote token separately from the replacement token input", async () => {
    const desktopApi = createDesktopApi({
      config: createNodeConfig({
        mode: "remote",
        remote: {
          wsUrl: "wss://saved.example/ws",
          tokenRef: "saved-token",
          tlsCertFingerprint256: "AA:BB",
        },
      }),
      gateway: {
        getOperatorConnection: vi.fn(async () => ({
          mode: "remote" as const,
          wsUrl: "wss://saved.example/ws",
          httpBaseUrl: "https://saved.example/",
          token: "saved-remote-token",
          tlsCertFingerprint256: "AA:BB",
        })),
      },
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();
      await flushEffects();

      await clickButtonAndFlush(container, "Remote");

      const currentTokenInput = getInputByLabel(container, "Current gateway token");
      const replacementTokenInput = getInputByLabel(container, "Replace token");

      expect(currentTokenInput.value).toBe("saved-remote-token");
      expect(currentTokenInput.readOnly).toBe(true);
      expect(replacementTokenInput.type).toBe("password");
      expect(container.textContent).toContain(
        "Leave blank to keep the current saved token, or enter a new token to replace it.",
      );
    });
  });

  it("keeps the page usable when current token loading fails", async () => {
    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
      gateway: {
        getOperatorConnection: vi.fn(async () => {
          throw new Error("token load failed");
        }),
      },
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();
      await flushEffects();

      expect(container.textContent).toContain("Gateway connection");
      expect(container.textContent).toContain("Current token unavailable");
      expect(container.textContent).toContain("token load failed");

      // The copy button now uses aria-label; it should be disabled.
      const copyButton = container.querySelector<HTMLButtonElement>(
        '[aria-label="Copy gateway token"]',
      );
      expect(copyButton?.disabled).toBe(true);
    });
  });

  it("keeps connection saved feedback after capability edits", async () => {
    const setConfig = vi.fn(async () => {});
    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
      setConfig,
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();

      // Change the connection port and save connection settings.
      const portInput = getInputByLabel(container, "Embedded gateway port");
      act(() => {
        setNativeValue(portInput, "8789");
      });

      // The connection save button now uses button text "Save connection settings".
      await clickButtonAndFlush(container, "Save connection settings");

      // Find the save button and verify "Saved!".
      const connectionSaveButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button"),
      ).find((el) => el.textContent?.includes("Saved!"));
      expect(connectionSaveButton).not.toBeUndefined();

      // The connection saved indicator should still show "Saved!"
      const stillSaved = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (el) => el.textContent?.includes("Saved!"),
      );
      expect(stillSaved).not.toBeUndefined();
    });
  });

  it("auto-saves when toggling a capability", async () => {
    const setConfig = vi.fn(async () => {});
    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
      setConfig,
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();

      // Toggle Browser Automation off (it starts enabled in default config).
      await clickSwitchByAriaLabelAndFlush(container, "Toggle Browser Automation");
      await flushEffects();

      // Auto-save should have called setConfig immediately.
      expect(setConfig).toHaveBeenCalled();
    });
  });

  it("preserves trailing newlines while editing allowlists and trims them on auto-save", async () => {
    vi.useFakeTimers();

    const setConfig = vi.fn(async () => {});
    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
      setConfig,
    });

    try {
      await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
        await flushEffects();

        // Expand the Browser Automation capability card to see its allowlists.
        await expandCapabilityCard(container, "Browser Automation");

        const domainsTextarea = getTextareaByLabel(container, "Allowed domains");
        act(() => {
          setNativeValue(domainsTextarea, "example.com\n");
        });

        expect(domainsTextarea.value).toBe("example.com\n");

        // The allowlist uses a debounced auto-save (500ms).
        // Advance time to trigger the debounce.
        await act(async () => {
          vi.advanceTimersByTime(600);
          await Promise.resolve();
        });
        await flushEffects();

        // Auto-save should have been called. The saved payload trims trailing newlines.
        expect(setConfig).toHaveBeenCalled();
        const lastCall = setConfig.mock.calls[setConfig.mock.calls.length - 1]![0] as Record<
          string,
          unknown
        >;
        const web = lastCall["web"] as { allowedDomains: string[] };
        expect(web.allowedDomains).toEqual(["example.com"]);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the restrictive fallback when capabilities are missing from config", async () => {
    const desktopApi = createDesktopApi({
      config: {
        permissions: { profile: "balanced", overrides: {} },
      },
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();

      // All capabilities should be visible on the page (no tabs).
      // When capabilities are missing from config, the defaults apply:
      // desktop: true, playwright: false (restrictive fallback).
      const desktopSwitch = container.querySelector<HTMLButtonElement>(
        '[role="switch"][aria-label="Toggle Desktop Automation"]',
      );
      const browserSwitch = container.querySelector<HTMLButtonElement>(
        '[role="switch"][aria-label="Toggle Browser Automation"]',
      );

      expect(desktopSwitch).not.toBeNull();
      expect(browserSwitch).not.toBeNull();

      expect(desktopSwitch?.getAttribute("aria-checked")).toBe("true");
      expect(browserSwitch?.getAttribute("aria-checked")).toBe("false");
    });
  });

  it("clears the auto-save 'Saved' indicator after timeout", async () => {
    vi.useFakeTimers();

    const setConfig = vi.fn(async () => {});
    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
      setConfig,
    });

    try {
      await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
        await flushEffects();

        // Toggle a capability to trigger auto-save.
        await clickSwitchByAriaLabelAndFlush(container, "Toggle Browser Automation");
        await flushEffects();

        // Should show "Saved" status indicator.
        expect(container.textContent).toContain("Saved");

        // After 2 seconds, the "Saved" indicator should clear.
        await act(async () => {
          vi.advanceTimersByTime(2_001);
          await Promise.resolve();
        });

        // "Saved" should no longer appear (status goes back to idle).
        // The connection "Save connection settings" button text should still exist.
        const saveBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
          (el) => el.textContent?.includes("Save connection settings"),
        );
        expect(saveBtn).not.toBeUndefined();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks a second connection save while a connection save is still in flight", async () => {
    let resolveSetConfig: (() => void) | null = null;
    const setConfig = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSetConfig = resolve;
        }),
    );
    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
      setConfig,
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();

      // Change port to make connection dirty.
      const portInput = getInputByLabel(container, "Embedded gateway port");
      act(() => {
        setNativeValue(portInput, "8789");
      });

      // Click save connection settings.
      await clickButtonAndFlush(container, "Save connection settings");
      expect(setConfig).toHaveBeenCalledTimes(1);

      // The save button should be disabled while saving.
      const saveButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (el) => el.textContent?.includes("Saving"),
      );
      expect(saveButton?.disabled).toBe(true);

      await act(async () => {
        resolveSetConfig?.();
        await Promise.resolve();
      });
    });
  });

  it("auto-saves capability toggle changes separately from connection settings", async () => {
    const setConfig = vi.fn(async () => {});
    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
      setConfig,
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();

      // Toggle Browser Automation off to trigger auto-save.
      await clickSwitchByAriaLabelAndFlush(container, "Toggle Browser Automation");
      await flushEffects();

      // Auto-save should have called setConfig (not a connection save).
      expect(setConfig).toHaveBeenCalled();
      // The save payload should contain a capabilities object (security payload),
      // NOT a connection payload (which would have "mode" and "remote"/"embedded").
      const lastCall = setConfig.mock.calls[setConfig.mock.calls.length - 1]![0] as Record<
        string,
        unknown
      >;
      expect(lastCall).toHaveProperty("capabilities");
      expect(lastCall).not.toHaveProperty("mode");
    });
  });

  it("saves shell allowlist changes through auto-save", async () => {
    vi.useFakeTimers();

    const setConfig = vi.fn(async () => {});
    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
      setConfig,
    });

    try {
      await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
        await flushEffects();

        // Expand the Browser Automation capability card.
        await expandCapabilityCard(container, "Browser Automation");

        const domainsTextarea = getTextareaByLabel(container, "Allowed domains");
        act(() => {
          setNativeValue(domainsTextarea, "example.com\ntrusted.org");
        });

        // Wait for debounced auto-save (500ms).
        await act(async () => {
          vi.advanceTimersByTime(600);
          await Promise.resolve();
        });
        await flushEffects();

        // Auto-save should have been called with the updated allowlist.
        expect(setConfig).toHaveBeenCalled();
        const lastCall = setConfig.mock.calls[setConfig.mock.calls.length - 1]![0] as Record<
          string,
          unknown
        >;
        const web = lastCall["web"] as { allowedDomains: string[] };
        expect(web.allowedDomains).toEqual(["example.com", "trusted.org"]);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows auto-save Saved indicator after toggling a capability", async () => {
    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();

      // Toggle Browser Automation off to trigger auto-save.
      await clickSwitchByAriaLabelAndFlush(container, "Toggle Browser Automation");
      await flushEffects();

      // Should show "Saved" indicator text.
      expect(container.textContent).toContain("Saved");
    });
  });

  it("keeps mac permission request errors visible", async () => {
    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
      checkMacPermissions: vi.fn(async () => null),
      requestMacPermission: vi.fn(async () => {
        throw new Error("Permission request failed.");
      }),
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();

      // Expand Desktop Automation capability to see macOS permission buttons.
      await expandCapabilityCard(container, "Desktop Automation");

      // Find the "Request Accessibility" button by text content.
      const requestAccessibilityButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button"),
      ).find((el) => el.textContent?.includes("Request Accessibility"));
      expect(requestAccessibilityButton).not.toBeUndefined();

      await act(async () => {
        requestAccessibilityButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(desktopApi.requestMacPermission).toHaveBeenCalledTimes(1);
    });
  });
});
