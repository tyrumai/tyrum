// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clickButtonAndFlush,
  clickByTestIdAndFlush,
  clickLabelAndFlush,
  clickSwitchAndFlush,
  clickTabAndFlush,
  createDesktopApi,
  createNodeConfig,
  flushEffects,
  getInputByLabel,
  getTextareaByLabel,
  withBrowserCapabilitiesPage,
  withDesktopNodeConfigurePage,
  withHostNodeConfigurePage,
} from "./platform-pages.test-support.js";
import { setNativeValue } from "../test-utils.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Platform pages", () => {
  it("renders the browser capabilities page", async () => {
    const storage = globalThis.localStorage;
    if (storage && typeof storage.removeItem === "function") {
      storage.removeItem("tyrum.operator-ui.browserNode.enabled");
    }

    await withBrowserCapabilitiesPage(({ container }) => {
      expect(container.textContent).toContain("Browser node executor");
      expect(container.textContent).toContain("Status");
    });
  });

  it("shows node-configure fallback states for non-desktop and missing desktop api", async () => {
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

  it("shows and copies the current embedded gateway token", async () => {
    const writeText = vi.fn(async () => {});
    const getOperatorConnection = vi.fn(async () => ({
      mode: "embedded" as const,
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788/",
      token: "tyrum-token.v1.embedded.token",
      tlsCertFingerprint256: "",
      tlsAllowSelfSigned: false,
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

      await clickByTestIdAndFlush(container, "node-current-token-copy");

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
          tlsAllowSelfSigned: false,
        },
      }),
      gateway: {
        getOperatorConnection: vi.fn(async () => ({
          mode: "remote" as const,
          wsUrl: "wss://saved.example/ws",
          httpBaseUrl: "https://saved.example/",
          token: "saved-remote-token",
          tlsCertFingerprint256: "AA:BB",
          tlsAllowSelfSigned: false,
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

      const copyButton = container.querySelector<HTMLButtonElement>(
        '[data-testid="node-current-token-copy"]',
      );
      expect(copyButton?.disabled).toBe(true);
    });
  });

  it("clears connection saved feedback after shell edits", async () => {
    const setConfig = vi.fn(async () => {});
    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
      setConfig,
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();
      const portInput = getInputByLabel(container, "Embedded gateway port");
      act(() => {
        setNativeValue(portInput, "8789");
      });
      await clickByTestIdAndFlush(container, "node-configure-save-connection");

      const connectionSaveButton = container.querySelector<HTMLButtonElement>(
        '[data-testid="node-configure-save-connection"]',
      );
      expect(connectionSaveButton?.textContent).toContain("Saved!");

      await clickTabAndFlush(container, "Shell");
      const commandsTextarea = getTextareaByLabel(container, "Allowed commands");
      act(() => {
        setNativeValue(commandsTextarea, "echo hello");
      });

      await clickTabAndFlush(container, "Connection");
      expect(
        container.querySelector<HTMLButtonElement>('[data-testid="node-configure-save-connection"]')
          ?.textContent,
      ).toBe("Save Connection Settings");
    });
  });

  it("switches the displayed profile to custom after manual capability changes", async () => {
    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();
      await clickTabAndFlush(container, "Profile");
      await clickLabelAndFlush(container, "Safe");
      await clickTabAndFlush(container, "Browser");
      await clickByTestIdAndFlush(container, "node-capability-browser");
      await clickTabAndFlush(container, "Profile");

      const customRadio = container.querySelector<HTMLElement>("#node-profile-custom");
      expect(customRadio?.getAttribute("data-state")).toBe("checked");
    });
  });

  it("preserves trailing newlines while editing allowlists and trims them on save", async () => {
    const setConfig = vi.fn(async () => {});
    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
      setConfig,
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();
      await clickTabAndFlush(container, "Shell");

      const commandsTextarea = getTextareaByLabel(container, "Allowed commands");
      act(() => {
        setNativeValue(commandsTextarea, "git status\n");
      });

      expect(commandsTextarea.value).toBe("git status\n");
      await clickByTestIdAndFlush(container, "node-configure-save-security");

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
    });
  });

  it("preserves the restrictive fallback when capabilities are missing from config", async () => {
    const desktopApi = createDesktopApi({
      config: {
        permissions: { profile: "balanced", overrides: {} },
      },
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();
      await clickTabAndFlush(container, "Profile");

      const balancedRadio = container.querySelector<HTMLElement>("#node-profile-balanced");
      const customRadio = container.querySelector<HTMLElement>("#node-profile-custom");

      expect(balancedRadio?.getAttribute("data-state")).toBe("unchecked");
      expect(customRadio?.getAttribute("data-state")).toBe("checked");

      await clickTabAndFlush(container, "Desktop");
      expect(
        container
          .querySelector<HTMLButtonElement>('[data-testid="node-capability-desktop"]')
          ?.getAttribute("aria-checked"),
      ).toBe("true");

      await clickTabAndFlush(container, "Browser");
      expect(
        container
          .querySelector<HTMLButtonElement>('[data-testid="node-capability-browser"]')
          ?.getAttribute("aria-checked"),
      ).toBe("false");

      await clickTabAndFlush(container, "Shell");
      expect(
        container
          .querySelector<HTMLButtonElement>('[data-testid="node-capability-shell"]')
          ?.getAttribute("aria-checked"),
      ).toBe("false");

      await clickTabAndFlush(container, "Web");
      expect(
        container
          .querySelector<HTMLButtonElement>('[data-testid="node-capability-web"]')
          ?.getAttribute("aria-checked"),
      ).toBe("false");
    });
  });

  it("clears connection and security saved indicators independently", async () => {
    vi.useFakeTimers();

    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
    });

    try {
      await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
        await flushEffects();

        const portInput = getInputByLabel(container, "Embedded gateway port");
        act(() => {
          setNativeValue(portInput, "8789");
        });

        await clickByTestIdAndFlush(container, "node-configure-save-connection");
        expect(container.textContent).toContain("Saved!");

        await clickTabAndFlush(container, "Browser");
        await clickByTestIdAndFlush(container, "node-capability-browser");
        await clickByTestIdAndFlush(container, "node-configure-save-security");
        expect(container.textContent).toContain("Saved!");

        await act(async () => {
          vi.advanceTimersByTime(2_001);
          await Promise.resolve();
        });

        const securitySaveButton = container.querySelector<HTMLButtonElement>(
          '[data-testid="node-configure-save-security"]',
        );
        expect(securitySaveButton?.textContent).toContain("Save Node Settings");

        await clickTabAndFlush(container, "Connection");
        const connectionSaveButton = container.querySelector<HTMLButtonElement>(
          '[data-testid="node-configure-save-connection"]',
        );
        expect(connectionSaveButton?.textContent).toContain("Save Connection Settings");
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks a second save while a connection save is still in flight", async () => {
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

      const portInput = getInputByLabel(container, "Embedded gateway port");
      act(() => {
        setNativeValue(portInput, "8789");
      });

      await clickByTestIdAndFlush(container, "node-configure-save-connection");
      expect(setConfig).toHaveBeenCalledTimes(1);

      await clickTabAndFlush(container, "Browser");
      const securitySaveButton = container.querySelector<HTMLButtonElement>(
        '[data-testid="node-configure-save-security"]',
      );
      expect(securitySaveButton?.disabled).toBe(true);

      await clickByTestIdAndFlush(container, "node-capability-browser");
      await clickByTestIdAndFlush(container, "node-configure-save-security");
      expect(setConfig).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveSetConfig?.();
        await Promise.resolve();
      });
    });
  });

  it("saves profile changes separately from connection settings", async () => {
    const setConfig = vi.fn(async () => {});
    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
      setConfig,
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();
      await clickTabAndFlush(container, "Profile");
      await clickLabelAndFlush(container, "Safe");
      await clickByTestIdAndFlush(container, "node-configure-save-profile");

      expect(setConfig).toHaveBeenCalledTimes(1);
      expect(setConfig).toHaveBeenCalledWith({
        permissions: { profile: "safe", overrides: {} },
        capabilities: { desktop: true, playwright: false, cli: false, http: false },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      });
    });
  });

  it("saves shell allowlist changes through node settings", async () => {
    const setConfig = vi.fn(async () => {});
    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
      setConfig,
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();
      await clickTabAndFlush(container, "Shell");

      const commandsTextarea = getTextareaByLabel(container, "Allowed commands");
      act(() => {
        setNativeValue(commandsTextarea, "git status\nnode --version");
      });

      await clickByTestIdAndFlush(container, "node-configure-save-security");

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
    });
  });

  it("disables the security save button after a successful save", async () => {
    const desktopApi = createDesktopApi({
      config: createNodeConfig(),
    });

    await withDesktopNodeConfigurePage(desktopApi, async ({ container }) => {
      await flushEffects();
      await clickTabAndFlush(container, "Shell");

      const commandsTextarea = getTextareaByLabel(container, "Allowed commands");
      act(() => {
        setNativeValue(commandsTextarea, "git status");
      });

      const saveButtonBeforeSave = container.querySelector<HTMLButtonElement>(
        '[data-testid="node-configure-save-security"]',
      );
      expect(saveButtonBeforeSave?.disabled).toBe(false);

      await clickByTestIdAndFlush(container, "node-configure-save-security");

      const saveButtonAfterSave = container.querySelector<HTMLButtonElement>(
        '[data-testid="node-configure-save-security"]',
      );
      expect(saveButtonAfterSave?.textContent).toContain("Saved!");
      expect(saveButtonAfterSave?.disabled).toBe(true);
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
      await clickTabAndFlush(container, "Desktop");
      await clickByTestIdAndFlush(container, "node-request-accessibility");

      expect(desktopApi.requestMacPermission).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain("Permission request failed.");
    });
  });
});
