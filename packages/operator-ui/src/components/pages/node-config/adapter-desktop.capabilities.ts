import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { DesktopApi } from "../../../desktop-api.js";
import { formatErrorMessage } from "../../../utils/format-error-message.js";
import type { CapFlags } from "../../../utils/permission-profile.js";
import {
  BROWSER_DOMAIN_NOTES,
  type MacPermissionSnapshot,
  type SecurityState,
  describeMacPermissionSummary,
  splitAllowlistLines,
} from "../node-configure-page.shared.js";
import { MacPermissionsContent } from "./node-config-page.mac-permissions.js";
import {
  BROWSER_AUTOMATION_ACTIONS,
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
  } = input;

  // ── macOS permissions state ─────────────────────────────────────────────

  const [macPermissionSummary, setMacPermissionSummary] = useState<string | null>(null);
  const [macPermissionChecking, setMacPermissionChecking] = useState(false);
  const [requestingMacPermission, setRequestingMacPermission] = useState<
    "accessibility" | "screenRecording" | null
  >(null);

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
    void api
      .checkMacPermissions()
      .then((snapshot) =>
        setMacPermissionSummary(
          describeMacPermissionSummary(snapshot as MacPermissionSnapshot | null),
        ),
      )
      .catch((error: unknown) => {
        toast.error("Permission request failed", { description: formatErrorMessage(error) });
      })
      .finally(() => setMacPermissionChecking(false));
  }, [api, macPermissionChecking]);

  const requestMacPermission = useCallback(
    (permission: "accessibility" | "screenRecording") => {
      if (!api.requestMacPermission || requestingMacPermission !== null) return;
      setRequestingMacPermission(permission);
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
        .catch((error: unknown) => {
          toast.error("Permission request failed", { description: formatErrorMessage(error) });
        })
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
    const playwrightActions: CapabilityAction[] = BROWSER_AUTOMATION_ACTIONS.map((action) => ({
      name: action.key,
      label: action.label,
      description: action.description,
      enabled: true,
      availabilityStatus: "available" as const,
      onToggle: () => {
        // Browser automation actions are all-or-nothing; the whole capability is toggled.
      },
    }));

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
        ? `${BROWSER_AUTOMATION_ACTIONS.length} actions enabled${browserAllowlistActive ? " \u00b7 allowlist active" : ""}`
        : "disabled",
      saveStatus,
      saveError,
      actions: playwrightActions,
      allowlists: playwrightAllowlists,
      toggles: playwrightToggles,
      testActions: buildTestActions("playwright"),
    };

    return [desktopCapability, playwrightCapability];
  }, [
    allowlistDrafts,
    api.checkMacPermissions,
    buildTestActions,
    checkMacPermissions,
    macPermissionChecking,
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
  ]);
}
