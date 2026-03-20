import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useApiAction } from "../../hooks/use-api-action.js";
import type { OperatorUiMode } from "../../app.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import type { DesktopEnvironmentLogsState } from "./desktop-environments-page.sections.js";
import type { AdminHttpClient } from "./admin-http-shared.js";

export function shouldUseCrossOriginTakeoverFallback(
  mode: OperatorUiMode | undefined,
  coreHttpBaseUrl: string,
): boolean {
  if (mode !== "web" || typeof window === "undefined") {
    return false;
  }

  const currentOrigin = window.location.origin;
  if (!currentOrigin || currentOrigin === "null") {
    return false;
  }

  try {
    return new URL(coreHttpBaseUrl).origin !== currentOrigin;
  } catch {
    return false;
  }
}

function openTakeoverWindow(takeoverUrl: string): void {
  if (typeof window === "undefined" || typeof window.open !== "function") {
    throw new Error("Opening takeover is unavailable in this environment.");
  }

  const openedWindow = window.open(takeoverUrl, "_blank", "noopener,noreferrer");
  if (openedWindow === null) {
    throw new Error("Allow pop-ups to open the takeover window.");
  }
}

export function useDesktopEnvironmentPageActions(params: {
  adminHttpRef: MutableRefObject<AdminHttpClient | null>;
  canMutate: boolean;
  requestEnter: () => void;
  refreshPageData: (httpClient: AdminHttpClient) => Promise<void>;
  refreshEnvironments: (httpClient: AdminHttpClient) => Promise<unknown>;
  saveRuntimeDefaults: (httpClient: AdminHttpClient) => Promise<unknown>;
  createHostId: string;
  createLabel: string;
  createImageRef: string;
  runtimeDefaultImageRef: string;
  setPendingSelectedEnvironmentId: Dispatch<SetStateAction<string | null>>;
  setCreateLabel: Dispatch<SetStateAction<string>>;
  setLogsById: Dispatch<SetStateAction<Record<string, DesktopEnvironmentLogsState | undefined>>>;
}) {
  const refreshAction = useApiAction<void>();
  const mutation = useApiAction<unknown>();
  const takeoverAction = useApiAction<void>();

  function requireMutation(action: () => void): void {
    if (!params.canMutate) {
      params.requestEnter();
      return;
    }
    action();
  }

  function requireAdminHttp(): AdminHttpClient {
    const httpClient = params.adminHttpRef.current;
    if (!httpClient) {
      throw new Error("Authorize admin access to continue.");
    }
    return httpClient;
  }

  function runRefresh(): void {
    const httpClient = params.adminHttpRef.current;
    if (!httpClient) {
      params.requestEnter();
      return;
    }
    void refreshAction.run(async () => {
      await params.refreshPageData(httpClient);
    });
  }

  function runCreate(): void {
    requireMutation(() => {
      void mutation.run(async () => {
        const httpClient = requireAdminHttp();
        const created = await httpClient.desktopEnvironments.create({
          host_id: params.createHostId,
          label: params.createLabel.trim() || undefined,
          image_ref: params.createImageRef.trim() || params.runtimeDefaultImageRef,
          desired_running: false,
        });
        const createdEnvironmentId = created.environment.environment_id;
        params.setPendingSelectedEnvironmentId(createdEnvironmentId);
        params.setCreateLabel("");
        try {
          await params.refreshEnvironments(httpClient);
        } catch (error) {
          params.setPendingSelectedEnvironmentId((current) =>
            current === createdEnvironmentId ? null : current,
          );
          throw error;
        }
        return created.environment;
      });
    });
  }

  function runSaveRuntimeDefaults(): void {
    requireMutation(() => {
      void params.saveRuntimeDefaults(requireAdminHttp()).catch(() => {});
    });
  }

  function runAction(action: (httpClient: AdminHttpClient) => Promise<unknown>): void {
    requireMutation(() => {
      void mutation.run(async () => {
        const httpClient = requireAdminHttp();
        const result = await action(httpClient);
        await params.refreshEnvironments(httpClient);
        return result;
      });
    });
  }

  function runRefreshLogs(environmentId: string): void {
    const httpClient = params.adminHttpRef.current;
    if (!httpClient) {
      params.requestEnter();
      return;
    }
    void mutation.run(async () => {
      params.setLogsById((current) => ({
        ...current,
        [environmentId]: {
          lines: current[environmentId]?.lines ?? [],
          loading: true,
          error: null,
          lastSyncedAt: current[environmentId]?.lastSyncedAt ?? null,
        },
      }));

      try {
        const result = await httpClient.desktopEnvironments.logs(environmentId);
        if (params.adminHttpRef.current !== httpClient) return;
        params.setLogsById((current) => ({
          ...current,
          [environmentId]: {
            lines: result.logs,
            loading: false,
            error: null,
            lastSyncedAt: new Date().toISOString(),
          },
        }));
      } catch (error) {
        if (params.adminHttpRef.current !== httpClient) return;
        params.setLogsById((current) => ({
          ...current,
          [environmentId]: {
            lines: current[environmentId]?.lines ?? [],
            loading: false,
            error: formatErrorMessage(error),
            lastSyncedAt: current[environmentId]?.lastSyncedAt ?? null,
          },
        }));
        throw error;
      }
    });
  }

  function runOpenTakeover(environmentId: string): void {
    const httpClient = params.adminHttpRef.current;
    if (!httpClient) {
      params.requestEnter();
      return;
    }

    void takeoverAction.run(async () => {
      const result = await httpClient.desktopEnvironments.takeoverUrl(environmentId);
      openTakeoverWindow(result.takeover_url);
    });
  }

  return {
    mutation,
    refreshAction,
    runAction,
    runCreate,
    runOpenTakeover,
    runRefresh,
    runRefreshLogs,
    runSaveRuntimeDefaults,
    takeoverAction,
  };
}
