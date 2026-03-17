import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopApi } from "../../../desktop-api.js";
import { formatErrorMessage } from "../../../utils/format-error-message.js";
import type { CapFlags } from "../../../utils/permission-profile.js";
import {
  BROWSER_DOMAIN_NOTES,
  type MacPermissionSnapshot,
  type SecurityState,
  SHELL_COMMAND_NOTES,
  SHELL_DIRECTORY_NOTES,
  describeMacPermissionSummary,
  splitAllowlistLines,
} from "../node-configure-page.shared.js";
import { MacPermissionsContent } from "./node-config-page.mac-permissions.js";
import {
  DESKTOP_ACTIONS,
  getCatalogEntry,
  TEST_ACTION_DEFINITIONS,
} from "./node-config-page.capability-catalog.js";
import type {
  CapabilityAction,
  CapabilityAllowlist,
  CapabilityTestAction,
  CapabilityToggle,
  NormalizedCapability,
  SaveStatus,
} from "./node-config-page.types.js";

// ─── Allowlist draft state (local text values) ──────────────────────────────

export interface AllowlistDrafts {
  browserDomains: string;
  cliCommands: string;
  cliWorkingDirs: string;
}

// ─── Input parameters ───────────────────────────────────────────────────────

export interface UseDesktopCapabilitiesInput {
  api: DesktopApi;
  security: SecurityState;
  allowlistDrafts: AllowlistDrafts;
  saveStatus: SaveStatus;
  saveError: string | null;
  executorDeviceId: string | null;
  dispatchTest: DesktopTestDispatch | undefined;
  setCapability: (key: keyof CapFlags, enabled: boolean) => void;
  setBrowserHeadless: (headless: boolean) => void;
  updateBrowserDomains: (value: string) => void;
  updateCliCommands: (value: string) => void;
  updateCliWorkingDirs: (value: string) => void;
}

export type DesktopTestDispatch = (
  nodeId: string,
  capabilityKey: string,
  actionName: string,
  input: Record<string, unknown>,
) => Promise<unknown>;

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useDesktopCapabilities(input: UseDesktopCapabilitiesInput): NormalizedCapability[] {
  const {
    api,
    security,
    allowlistDrafts,
    saveStatus,
    saveError,
    executorDeviceId,
    dispatchTest,
    setCapability,
    setBrowserHeadless,
    updateBrowserDomains,
    updateCliCommands,
    updateCliWorkingDirs,
  } = input;

  // ── macOS permissions state ─────────────────────────────────────────────

  const [macPermissionSummary, setMacPermissionSummary] = useState<string | null>(null);
  const [macPermissionChecking, setMacPermissionChecking] = useState(false);
  const [requestingMacPermission, setRequestingMacPermission] = useState<
    "accessibility" | "screenRecording" | null
  >(null);
  const [macPermissionError, setMacPermissionError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── macOS permission handlers ───────────────────────────────────────────

  const checkMacPermissions = useCallback(() => {
    if (!api.checkMacPermissions || macPermissionChecking) return;
    setMacPermissionChecking(true);
    setMacPermissionError(null);
    void api
      .checkMacPermissions()
      .then((snapshot) =>
        setMacPermissionSummary(
          describeMacPermissionSummary(snapshot as MacPermissionSnapshot | null),
        ),
      )
      .catch((error: unknown) => setMacPermissionError(formatErrorMessage(error)))
      .finally(() => setMacPermissionChecking(false));
  }, [api, macPermissionChecking]);

  const requestMacPermission = useCallback(
    (permission: "accessibility" | "screenRecording") => {
      if (!api.requestMacPermission || requestingMacPermission !== null) return;
      setRequestingMacPermission(permission);
      setMacPermissionError(null);
      void api
        .requestMacPermission(permission)
        .then(() => {
          if (!mountedRef.current) return;
          // Refresh permissions after request.
          if (api.checkMacPermissions) {
            void api
              .checkMacPermissions()
              .then((snapshot) =>
                setMacPermissionSummary(
                  describeMacPermissionSummary(snapshot as MacPermissionSnapshot | null),
                ),
              )
              .catch(() => {
                // Best-effort refresh.
              });
          }
        })
        .catch((error: unknown) => setMacPermissionError(formatErrorMessage(error)))
        .finally(() => setRequestingMacPermission(null));
    },
    [api, requestingMacPermission],
  );

  // ── Build test actions for a capability ─────────────────────────────────

  const buildTestActions = useCallback(
    (capabilityKey: string): CapabilityTestAction[] => {
      const defs = TEST_ACTION_DEFINITIONS[capabilityKey] ?? [];
      return defs.map((def) => ({
        label: def.label,
        actionName: def.actionName,
        available: !!dispatchTest && executorDeviceId !== null,
        onRun: async () => {
          if (!dispatchTest || !executorDeviceId) {
            throw new Error("Test dispatch is not available");
          }
          return dispatchTest(executorDeviceId, capabilityKey, def.actionName, def.defaultInput);
        },
      }));
    },
    [dispatchTest, executorDeviceId],
  );

  // ── Build capabilities array ──────────────────────────────────────────

  return useMemo<NormalizedCapability[]>(() => {
    const desktopCatalog = getCatalogEntry("desktop");
    const playwrightCatalog = getCatalogEntry("playwright");
    const cliCatalog = getCatalogEntry("cli");
    const httpCatalog = getCatalogEntry("http");

    // 1. Desktop Automation
    const desktopEnabled = security.capabilities.desktop;
    const desktopActions: CapabilityAction[] = DESKTOP_ACTIONS.map((action) => ({
      name: action.name,
      label: action.label,
      description: action.description,
      enabled: true,
      availabilityStatus: "available" as const,
      onToggle: () => {
        // Desktop actions are all-or-nothing; the whole capability is toggled.
      },
    }));

    const desktopExtraContent = createElement(MacPermissionsContent, {
      apiAvailable: !!api.checkMacPermissions,
      summary: macPermissionSummary,
      checking: macPermissionChecking,
      requestingPermission: requestingMacPermission,
      errorMessage: macPermissionError,
      onCheck: checkMacPermissions,
      onRequest: requestMacPermission,
    });

    const desktopCapability: NormalizedCapability = {
      key: "desktop",
      label: desktopCatalog?.label ?? "Desktop Automation",
      description: desktopCatalog?.description ?? "",
      icon: desktopCatalog!.icon,
      enabled: desktopEnabled,
      onToggle: (enabled) => setCapability("desktop", enabled),
      statusSummary: desktopEnabled ? `${DESKTOP_ACTIONS.length} actions enabled` : "disabled",
      saveStatus,
      saveError,
      actions: desktopActions,
      allowlists: [],
      toggles: [],
      testActions: buildTestActions("desktop"),
      extraContent: desktopExtraContent,
    };

    // 2. Playwright (Browser Automation)
    const playwrightEnabled = security.capabilities.playwright;
    const browserAllowlistActive = playwrightEnabled;
    const browserDomainsEmpty = splitAllowlistLines(allowlistDrafts.browserDomains).length === 0;

    const playwrightAllowlists: CapabilityAllowlist[] = [
      {
        key: "browserDomains",
        label: "Allowed domains",
        active: browserAllowlistActive,
        value: allowlistDrafts.browserDomains,
        placeholder: "example.com",
        notes: BROWSER_DOMAIN_NOTES,
        warningTitle: "No domains configured",
        warningDescription:
          "The browser allowlist is active but no domains are configured. All navigation will be blocked.",
        showWarning: browserAllowlistActive && browserDomainsEmpty,
        saveStatus,
        saveError,
        onChange: updateBrowserDomains,
      },
    ];

    const playwrightToggles: CapabilityToggle[] = [
      {
        key: "headless",
        label: "Headless mode",
        description: "Launch browser without visible window",
        checked: security.web.headless,
        onChange: setBrowserHeadless,
      },
    ];

    const playwrightCapability: NormalizedCapability = {
      key: "playwright",
      label: playwrightCatalog?.label ?? "Browser Automation",
      description: playwrightCatalog?.description ?? "",
      icon: playwrightCatalog!.icon,
      enabled: playwrightEnabled,
      onToggle: (enabled) => setCapability("playwright", enabled),
      statusSummary: playwrightEnabled
        ? `enabled${browserAllowlistActive ? " \u00b7 allowlist active" : ""}`
        : "disabled",
      saveStatus,
      saveError,
      actions: [],
      allowlists: playwrightAllowlists,
      toggles: playwrightToggles,
      testActions: buildTestActions("playwright"),
    };

    // 3. CLI (Shell)
    const cliEnabled = security.capabilities.cli;
    const cliAllowlistActive = cliEnabled;
    const cliCommandsEmpty = splitAllowlistLines(allowlistDrafts.cliCommands).length === 0;
    const cliWorkingDirsEmpty = splitAllowlistLines(allowlistDrafts.cliWorkingDirs).length === 0;

    const cliAllowlists: CapabilityAllowlist[] = [
      {
        key: "cliCommands",
        label: "Allowed commands",
        active: cliAllowlistActive,
        value: allowlistDrafts.cliCommands,
        placeholder: "git status",
        notes: SHELL_COMMAND_NOTES,
        warningTitle: "No commands configured",
        warningDescription:
          "The command allowlist is active but no commands are configured. All commands will be blocked.",
        showWarning: cliAllowlistActive && cliCommandsEmpty,
        saveStatus,
        saveError,
        onChange: updateCliCommands,
      },
      {
        key: "cliWorkingDirs",
        label: "Allowed working directories",
        active: cliAllowlistActive,
        value: allowlistDrafts.cliWorkingDirs,
        placeholder: "/home/user/projects",
        notes: SHELL_DIRECTORY_NOTES,
        warningTitle: "No directories configured",
        warningDescription:
          "The directory allowlist is active but no directories are configured. All working directories will be blocked.",
        showWarning: cliAllowlistActive && cliWorkingDirsEmpty,
        saveStatus,
        saveError,
        onChange: updateCliWorkingDirs,
      },
    ];

    const cliCapability: NormalizedCapability = {
      key: "cli",
      label: cliCatalog?.label ?? "Shell",
      description: cliCatalog?.description ?? "",
      icon: cliCatalog!.icon,
      enabled: cliEnabled,
      onToggle: (enabled) => setCapability("cli", enabled),
      statusSummary: cliEnabled
        ? `enabled${cliAllowlistActive ? " \u00b7 allowlist active" : ""}`
        : "disabled",
      saveStatus,
      saveError,
      actions: [],
      allowlists: cliAllowlists,
      toggles: [],
      testActions: buildTestActions("cli"),
    };

    // 4. HTTP (Web)
    const httpEnabled = security.capabilities.http;

    const httpCapability: NormalizedCapability = {
      key: "http",
      label: httpCatalog?.label ?? "Web (HTTP)",
      description: httpCatalog?.description ?? "",
      icon: httpCatalog!.icon,
      enabled: httpEnabled,
      onToggle: (enabled) => setCapability("http", enabled),
      statusSummary: httpEnabled ? "enabled" : "disabled",
      saveStatus,
      saveError,
      actions: [],
      allowlists: [],
      toggles: [],
      testActions: buildTestActions("http"),
    };

    return [desktopCapability, playwrightCapability, cliCapability, httpCapability];
  }, [
    allowlistDrafts,
    api.checkMacPermissions,
    buildTestActions,
    checkMacPermissions,
    macPermissionChecking,
    macPermissionError,
    macPermissionSummary,
    requestMacPermission,
    requestingMacPermission,
    saveError,
    saveStatus,
    security.capabilities,
    security.web.headless,
    setCapability,
    setBrowserHeadless,
    updateBrowserDomains,
    updateCliCommands,
    updateCliWorkingDirs,
  ]);
}
