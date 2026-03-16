import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useHostApi,
  type MobileHostActionName,
  type MobileHostState,
} from "../../../host/host-api.js";
import { formatErrorMessage } from "../../../utils/format-error-message.js";
import { getCatalogEntry, TEST_ACTION_DEFINITIONS } from "./node-config-page.capability-catalog.js";
import type {
  CapabilityAction,
  CapabilityTestAction,
  NormalizedCapability,
  UnifiedNodeConfigModel,
} from "./node-config-page.types.js";

// ─── Mapping from catalog key to mobile action name ──────────────────────────

type MobileCapabilityKey = "location" | "camera" | "audio";

const CAPABILITY_KEY_TO_MOBILE_ACTION: Record<MobileCapabilityKey, MobileHostActionName> = {
  location: "location.get_current",
  camera: "camera.capture_photo",
  audio: "audio.record_clip",
};

const CAPABILITY_KEYS: readonly MobileCapabilityKey[] = ["location", "camera", "audio"];

// ─── Platform formatting ─────────────────────────────────────────────────────

function formatPlatform(platform: MobileHostState["platform"]): string {
  return platform === "ios" ? "iOS" : "Android";
}

// ─── Normalize mobile availability status ────────────────────────────────────

function normalizeAvailabilityStatus(status: "ready" | "unavailable"): "available" | "unavailable" {
  return status === "ready" ? "available" : "unavailable";
}

// ─── Status summary ──────────────────────────────────────────────────────────

function buildStatusSummary(
  enabled: boolean,
  availabilityStatus: "available" | "unavailable",
): string {
  if (!enabled) return "disabled";
  return `enabled \u00b7 ${availabilityStatus}`;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type MobileTestDispatch = (
  actionName: string,
  input: Record<string, unknown>,
) => Promise<unknown>;

export interface UseNodeConfigMobileOptions {
  dispatchTest?: MobileTestDispatch;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useNodeConfigMobile(
  options: UseNodeConfigMobileOptions = {},
): UnifiedNodeConfigModel {
  const { dispatchTest } = options;

  const host = useHostApi();
  const [state, setState] = useState<MobileHostState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // ── Initial load + subscription ──────────────────────────────────────────

  useEffect(() => {
    if (host.kind !== "mobile") return;
    let active = true;

    void host.api.node
      .getState()
      .then((nextState) => {
        if (!active) return;
        setState(nextState);
        setErrorMessage(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setErrorMessage(formatErrorMessage(error));
      });

    const unsubscribe = host.api.onStateChange?.((nextState) => {
      if (!active) return;
      setState(nextState);
      setErrorMessage(null);
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [host]);

  // ── State update helper ──────────────────────────────────────────────────

  const applyStateChange = useCallback(
    async (nextBusyKey: string, update: () => Promise<MobileHostState>): Promise<void> => {
      if (busyKey) return;
      setBusyKey(nextBusyKey);
      try {
        const nextState = await update();
        setState(nextState);
        setErrorMessage(null);
      } catch (error: unknown) {
        setErrorMessage(formatErrorMessage(error));
      } finally {
        setBusyKey(null);
      }
    },
    [busyKey],
  );

  // ── Executor toggle ──────────────────────────────────────────────────────

  const onToggle = useCallback(
    (enabled: boolean) => {
      if (host.kind !== "mobile") return;
      void applyStateChange("enabled", () => host.api.node.setEnabled(enabled));
    },
    [applyStateChange, host],
  );

  // ── Capabilities ─────────────────────────────────────────────────────────

  const capabilities = useMemo<NormalizedCapability[]>(() => {
    if (!state) return [];

    return CAPABILITY_KEYS.map((key) => {
      const catalog = getCatalogEntry(key);
      const mobileAction = CAPABILITY_KEY_TO_MOBILE_ACTION[key];
      const actionState = state.actions[mobileAction];
      const normalizedAvailability = normalizeAvailabilityStatus(actionState.availabilityStatus);

      const capabilityOnToggle = (enabled: boolean): void => {
        if (host.kind !== "mobile") return;
        void applyStateChange(mobileAction, () =>
          host.api.node.setActionEnabled(mobileAction, enabled),
        );
      };

      const action: CapabilityAction = {
        name: mobileAction,
        label: catalog?.label ?? key,
        description: catalog?.description ?? "",
        enabled: actionState.enabled,
        availabilityStatus: normalizedAvailability,
        unavailableReason: actionState.unavailableReason ?? undefined,
        onToggle: capabilityOnToggle,
      };

      const testDefs = TEST_ACTION_DEFINITIONS[key] ?? [];
      const testActions: CapabilityTestAction[] = testDefs.map((def) => ({
        label: def.label,
        actionName: def.actionName,
        available:
          !!dispatchTest &&
          state.enabled &&
          actionState.enabled &&
          normalizedAvailability !== "unavailable",
        onRun: async () => {
          if (!dispatchTest) {
            throw new Error("Test dispatch is not available");
          }
          return dispatchTest(def.actionName, def.defaultInput);
        },
      }));

      return {
        key,
        label: catalog?.label ?? key,
        description: catalog?.description ?? "",
        icon: catalog?.icon ?? getCatalogEntry("location")!.icon,
        enabled: actionState.enabled,
        onToggle: capabilityOnToggle,
        statusSummary: buildStatusSummary(actionState.enabled, normalizedAvailability),
        saveStatus: "idle" as const,
        saveError: null,
        actions: [action],
        allowlists: [],
        toggles: [],
        testActions,
      };
    });
  }, [applyStateChange, dispatchTest, host, state]);

  // ── Executor status mapping ──────────────────────────────────────────────

  const executorStatus = state?.status ?? "disconnected";

  // ── Model ────────────────────────────────────────────────────────────────

  return useMemo<UnifiedNodeConfigModel>(
    () => ({
      platform: "mobile",
      loading: state === null && errorMessage === null,
      loadError: state === null ? errorMessage : null,
      connection: {
        mode: "readonly",
        platform: state ? formatPlatform(state.platform) : undefined,
      },
      executor: {
        enabled: state?.enabled ?? false,
        status: executorStatus,
        nodeId: state?.deviceId ?? null,
        error: errorMessage ?? state?.error ?? null,
        busy: busyKey !== null,
        onToggle,
      },
      capabilities,
    }),
    [busyKey, capabilities, errorMessage, executorStatus, onToggle, state],
  );
}
