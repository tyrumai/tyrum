import { useCallback, useMemo } from "react";
import {
  type BrowserCapabilityName,
  useBrowserNode,
} from "../../../browser-node/browser-node-provider.js";
import { getCatalogEntry, TEST_ACTION_DEFINITIONS } from "./node-config-page.capability-catalog.js";
import type {
  CapabilityAction,
  CapabilityTestAction,
  NormalizedCapability,
  UnifiedNodeConfigModel,
} from "./node-config-page.types.js";

// ─── Mapping from catalog key to browser capability name ─────────────────────

type BrowserCapabilityKey = "location" | "camera" | "audio";

const CAPABILITY_KEY_TO_BROWSER_NAME: Record<BrowserCapabilityKey, BrowserCapabilityName> = {
  location: "get",
  camera: "capture_photo",
  audio: "record",
};

const CAPABILITY_KEYS: readonly BrowserCapabilityKey[] = ["location", "camera", "audio"];

// ─── Status summary ──────────────────────────────────────────────────────────

function buildStatusSummary(enabled: boolean, availabilityStatus: string): string {
  if (!enabled) return "disabled";

  switch (availabilityStatus) {
    case "available":
      return "enabled \u00b7 available";
    case "unknown":
      return "enabled \u00b7 waiting for permission";
    case "unavailable":
      return "enabled \u00b7 unavailable";
    default:
      return `enabled \u00b7 ${availabilityStatus}`;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useNodeConfigBrowser(wsUrl: string): UnifiedNodeConfigModel {
  const browserNode = useBrowserNode();

  const capabilityToggle = useCallback(
    (key: BrowserCapabilityKey, enabled: boolean) => {
      browserNode.setCapabilityEnabled(CAPABILITY_KEY_TO_BROWSER_NAME[key], enabled);
    },
    [browserNode],
  );

  const capabilities = useMemo<NormalizedCapability[]>(() => {
    return CAPABILITY_KEYS.map((key) => {
      const catalog = getCatalogEntry(key);
      const browserName = CAPABILITY_KEY_TO_BROWSER_NAME[key];
      const state = browserNode.capabilityStates[browserName];

      const action: CapabilityAction = {
        name: browserName,
        label: catalog?.label ?? key,
        description: catalog?.description ?? "",
        enabled: state.enabled,
        availabilityStatus: state.availability_status,
        unavailableReason: state.unavailable_reason,
        onToggle: (enabled: boolean) => capabilityToggle(key, enabled),
      };

      const testDefs = TEST_ACTION_DEFINITIONS[key] ?? [];
      const testActions: CapabilityTestAction[] = testDefs.map((def) => ({
        label: def.label,
        actionName: def.actionName,
        available:
          browserNode.enabled && state.enabled && state.availability_status !== "unavailable",
        onRun: () =>
          browserNode.executeLocal({
            op: browserName,
            ...def.defaultInput,
          } as never),
      }));

      return {
        key,
        label: catalog?.label ?? key,
        description: catalog?.description ?? "",
        icon: catalog?.icon ?? getCatalogEntry("location")!.icon,
        enabled: state.enabled,
        onToggle: (enabled: boolean) => capabilityToggle(key, enabled),
        statusSummary: buildStatusSummary(state.enabled, state.availability_status),
        saveStatus: "idle" as const,
        saveError: null,
        actions: [action],
        allowlists: [],
        toggles: [],
        testActions,
      };
    });
  }, [browserNode, capabilityToggle]);

  const onToggle = useCallback(
    (enabled: boolean) => {
      browserNode.setEnabled(enabled);
    },
    [browserNode],
  );

  return useMemo<UnifiedNodeConfigModel>(
    () => ({
      platform: "browser",
      loading: false,
      loadError: null,
      connection: {
        mode: "readonly",
        gatewayUrl: wsUrl,
        platform: "Browser",
      },
      executor: {
        enabled: browserNode.enabled,
        status: browserNode.status,
        nodeId: browserNode.deviceId,
        error: browserNode.error,
        busy: false,
        onToggle,
      },
      capabilities,
    }),
    [
      browserNode.deviceId,
      browserNode.enabled,
      browserNode.error,
      browserNode.status,
      capabilities,
      onToggle,
      wsUrl,
    ],
  );
}
