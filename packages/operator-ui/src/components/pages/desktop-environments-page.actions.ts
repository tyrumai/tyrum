import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useApiAction } from "../../hooks/use-api-action.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import type { DesktopEnvironmentLogsState } from "./desktop-environments-page.sections.js";
import type { AdminHttpClient } from "./admin-http-shared.js";

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

  return {
    mutation,
    refreshAction,
    runAction,
    runCreate,
    runRefresh,
    runRefreshLogs,
    runSaveRuntimeDefaults,
  };
}
