import type { OperatorCore } from "@tyrum/operator-app";
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OperatorUiMode } from "../../app.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { isDesktopInventoryLoading } from "./desktop-environments-page.loading.js";
import {
  buildBlockingAvailabilityMessage,
  describeStartBlockedReason,
  DEFAULT_IMAGE_REF,
  isHostAvailable,
} from "./desktop-environments-page.shared.js";
import {
  CreateDesktopEnvironmentCard,
  DesktopEnvironmentsSummaryCard,
  DesktopEnvironmentHostsCard,
  DesktopEnvironmentListCard,
  RuntimeDefaultsCard,
  SelectedDesktopEnvironmentCard,
  type DesktopEnvironment,
  type DesktopEnvironmentHost,
  type DesktopEnvironmentLogsState,
} from "./desktop-environments-page.sections.js";
import { useDesktopEnvironmentRuntimeDefaults } from "./desktop-environments-page.runtime-defaults.js";
import type { RefreshResult } from "./desktop-environments-page.runtime-defaults.js";
import { AppPage } from "../layout/app-page.js";
import {
  AdminAccessGateCard,
  AdminMutationGate,
  isAdminAccessHttpError,
  useAdminHttpClient,
  useAdminMutationAccess,
  type AdminHttpClient,
} from "./admin-http-shared.js";
import { useDesktopEnvironmentPageActions } from "./desktop-environments-page.actions.js";
import { Button } from "../ui/button.js";
import {
  ManagedDesktopTakeoverDialog,
  useManagedDesktopTakeover,
} from "./managed-desktop-takeover.js";

export function DesktopEnvironmentsPage({
  core,
  mode: _mode,
}: {
  core: OperatorCore;
  mode?: OperatorUiMode;
}) {
  const adminHttp = useAdminHttpClient({ access: "strict" });
  const adminHttpRef = useRef<AdminHttpClient | null>(adminHttp);
  const { canMutate, requestEnter } = useAdminMutationAccess(core);

  const [hosts, setHosts] = useState<readonly DesktopEnvironmentHost[]>([]);
  const [hostsLoading, setHostsLoading] = useState(false);
  const [hostsLoadedForAdminHttp, setHostsLoadedForAdminHttp] = useState<AdminHttpClient | null>(
    null,
  );
  const [hostsError, setHostsError] = useState<string | null>(null);
  const [environments, setEnvironments] = useState<readonly DesktopEnvironment[]>([]);
  const [environmentsLoading, setEnvironmentsLoading] = useState(false);
  const [environmentsLoadedForAdminHttp, setEnvironmentsLoadedForAdminHttp] =
    useState<AdminHttpClient | null>(null);
  const [environmentsError, setEnvironmentsError] = useState<string | null>(null);
  const [requiresAdminAccess, setRequiresAdminAccess] = useState(false);
  const [logsById, setLogsById] = useState<Record<string, DesktopEnvironmentLogsState | undefined>>(
    {},
  );

  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(null);
  const [pendingSelectedEnvironmentId, setPendingSelectedEnvironmentId] = useState<string | null>(
    null,
  );
  const [createHostId, setCreateHostId] = useState<string>("");
  const [createLabel, setCreateLabel] = useState("");
  const [createImageRef, setCreateImageRef] = useState(DEFAULT_IMAGE_REF);

  adminHttpRef.current = adminHttp;

  const hostById = useMemo(
    () => Object.fromEntries(hosts.map((host) => [host.host_id, host])),
    [hosts],
  );
  const availableHosts = useMemo(() => hosts.filter((host) => isHostAvailable(host)), [hosts]);
  const runtimeDefaults = useDesktopEnvironmentRuntimeDefaults({
    isCurrentHttpClient: (httpClient) => adminHttpRef.current === httpClient,
    syncCreateImageRefToDefault: (nextDefaultImageRef) => {
      setCreateImageRef((current) => {
        const trimmed = current.trim();
        if (
          trimmed.length === 0 ||
          trimmed === runtimeDefaults.runtimeDefaultImageRef ||
          trimmed === DEFAULT_IMAGE_REF
        ) {
          return nextDefaultImageRef;
        }
        return current;
      });
    },
  });

  useEffect(() => {
    const firstAvailableHostId = availableHosts[0]?.host_id ?? "";
    if (createHostId.length === 0) {
      if (firstAvailableHostId) setCreateHostId(firstAvailableHostId);
      return;
    }
    const currentHost = hostById[createHostId];
    if (!currentHost || !isHostAvailable(currentHost)) {
      setCreateHostId(firstAvailableHostId);
    }
  }, [availableHosts, createHostId, hostById]);

  useEffect(() => {
    if (pendingSelectedEnvironmentId) {
      if (
        !environments.some(
          (environment) => environment.environment_id === pendingSelectedEnvironmentId,
        )
      ) {
        return;
      }
      setSelectedEnvironmentId(pendingSelectedEnvironmentId);
      setPendingSelectedEnvironmentId(null);
      return;
    }
    if (
      selectedEnvironmentId &&
      environments.some((environment) => environment.environment_id === selectedEnvironmentId)
    ) {
      return;
    }
    setSelectedEnvironmentId(environments[0]?.environment_id ?? null);
  }, [environments, pendingSelectedEnvironmentId, selectedEnvironmentId]);

  async function refreshHosts(
    httpClient: AdminHttpClient,
    options: { updateAdminAccess?: boolean } = {},
  ): Promise<RefreshResult> {
    const updateAdminAccess = options.updateAdminAccess ?? true;
    setHostsLoading(true);
    setHostsError(null);
    try {
      const result = await httpClient.desktopEnvironmentHosts.list();
      if (adminHttpRef.current !== httpClient) return "stale";
      setHosts(result.hosts);
      setHostsError(null);
      if (updateAdminAccess) {
        setRequiresAdminAccess(false);
      }
      return "ok";
    } catch (error) {
      if (adminHttpRef.current !== httpClient) return "stale";
      if (isAdminAccessHttpError(error)) {
        core.elevatedModeStore.exit();
        if (updateAdminAccess) {
          setRequiresAdminAccess(true);
        }
        setHostsError(null);
        return "admin-access-required";
      }
      setHostsError(formatErrorMessage(error));
      return "error";
    } finally {
      if (adminHttpRef.current === httpClient) {
        setHostsLoading(false);
        setHostsLoadedForAdminHttp(httpClient);
      }
    }
  }

  async function refreshEnvironments(
    httpClient: AdminHttpClient,
    options: { updateAdminAccess?: boolean } = {},
  ): Promise<RefreshResult> {
    const updateAdminAccess = options.updateAdminAccess ?? true;
    setEnvironmentsLoading(true);
    setEnvironmentsError(null);
    try {
      const result = await httpClient.desktopEnvironments.list();
      if (adminHttpRef.current !== httpClient) return "stale";
      setEnvironments(result.environments);
      setLogsById((current) =>
        Object.fromEntries(
          result.environments.map((environment) => [
            environment.environment_id,
            current[environment.environment_id],
          ]),
        ),
      );
      setEnvironmentsError(null);
      if (updateAdminAccess) {
        setRequiresAdminAccess(false);
      }
      return "ok";
    } catch (error) {
      if (adminHttpRef.current !== httpClient) return "stale";
      if (isAdminAccessHttpError(error)) {
        core.elevatedModeStore.exit();
        if (updateAdminAccess) {
          setRequiresAdminAccess(true);
        }
        setEnvironmentsError(null);
        return "admin-access-required";
      }
      setEnvironmentsError(formatErrorMessage(error));
      return "error";
    } finally {
      if (adminHttpRef.current === httpClient) {
        setEnvironmentsLoading(false);
        setEnvironmentsLoadedForAdminHttp(httpClient);
      }
    }
  }

  async function refreshPageData(httpClient: AdminHttpClient): Promise<void> {
    const [hostsResult, environmentsResult, defaultsResult] = await Promise.all([
      refreshHosts(httpClient, { updateAdminAccess: false }),
      refreshEnvironments(httpClient, { updateAdminAccess: false }),
      runtimeDefaults.refresh(httpClient),
    ]);
    if (adminHttpRef.current !== httpClient) {
      return;
    }
    if (
      hostsResult === "admin-access-required" ||
      environmentsResult === "admin-access-required" ||
      defaultsResult === "admin-access-required"
    ) {
      setRequiresAdminAccess(true);
      return;
    }
    setRequiresAdminAccess(false);
  }

  useEffect(() => {
    if (!adminHttp) {
      setHosts([]);
      setHostsLoading(false);
      setHostsLoadedForAdminHttp(null);
      setHostsError(null);
      setEnvironments([]);
      setEnvironmentsLoading(false);
      setEnvironmentsLoadedForAdminHttp(null);
      setEnvironmentsError(null);
      setLogsById({});
      setSelectedEnvironmentId(null);
      setPendingSelectedEnvironmentId(null);
      runtimeDefaults.reset();
      return;
    }
    void refreshPageData(adminHttp);
  }, [adminHttp]);

  const selectedEnvironment =
    selectedEnvironmentId === null
      ? null
      : (environments.find((environment) => environment.environment_id === selectedEnvironmentId) ??
        null);
  const selectedLogs = selectedEnvironmentId === null ? undefined : logsById[selectedEnvironmentId];
  const selectedHost = selectedEnvironment ? (hostById[selectedEnvironment.host_id] ?? null) : null;
  const hostsInitialLoading = isDesktopInventoryLoading({
    currentClient: adminHttp,
    loading: hostsLoading,
    loadedForClient: hostsLoadedForAdminHttp,
  });
  const environmentsInitialLoading = isDesktopInventoryLoading({
    currentClient: adminHttp,
    loading: environmentsLoading,
    loadedForClient: environmentsLoadedForAdminHttp,
  });
  const blockingAvailabilityMessage = buildBlockingAvailabilityMessage(hosts);
  const runtimeDefaultsSaveError = runtimeDefaults.runtimeDefaultsMutation.error
    ? formatErrorMessage(runtimeDefaults.runtimeDefaultsMutation.error)
    : null;
  const selectedStartBlockedReason = !selectedEnvironment
    ? null
    : describeStartBlockedReason({
        environmentHostId: selectedEnvironment.host_id,
        host: selectedHost,
      });
  const canStartSelectedEnvironment =
    selectedEnvironment !== null && selectedStartBlockedReason === null;
  const takeover = useManagedDesktopTakeover({
    getAdminHttp: () => adminHttpRef.current,
    requestEnter,
  });
  const {
    mutation,
    refreshAction,
    runAction,
    runCreate,
    runRefresh,
    runRefreshLogs,
    runSaveRuntimeDefaults,
  } = useDesktopEnvironmentPageActions({
    adminHttpRef,
    canMutate,
    requestEnter,
    refreshPageData,
    refreshEnvironments,
    saveRuntimeDefaults: runtimeDefaults.save,
    createHostId,
    createLabel,
    createImageRef,
    runtimeDefaultImageRef: runtimeDefaults.runtimeDefaultImageRef,
    setPendingSelectedEnvironmentId,
    setCreateLabel,
    setLogsById,
  });
  const takeoverError = takeover.error ? formatErrorMessage(takeover.error) : null;

  return (
    <>
      <AppPage
        title="Desktop Environments"
        actions={
          adminHttp ? (
            <Button
              variant="outline"
              size="sm"
              isLoading={refreshAction.isLoading}
              disabled={refreshAction.isLoading || hostsLoading || environmentsLoading}
              onClick={runRefresh}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          ) : undefined
        }
        contentClassName="max-w-6xl gap-4"
        data-testid="desktop-environments-page"
      >
        <DesktopEnvironmentsSummaryCard
          hostsError={hostsError}
          environmentsError={environmentsError}
          availabilityWarning={blockingAvailabilityMessage}
          mutationError={mutation.error ? formatErrorMessage(mutation.error) : null}
        />

        {requiresAdminAccess ? (
          <AdminAccessGateCard
            title="Authorize admin access to load desktop environments"
            description="Desktop environment hosts, environments, and mutations require temporary admin access."
            onAuthorize={requestEnter}
          />
        ) : !adminHttp ? (
          <AdminMutationGate
            core={core}
            title="Authorize admin access to load desktop environments"
            description="Desktop environment hosts, environments, and mutations require temporary admin access."
          >
            {null}
          </AdminMutationGate>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1.8fr]">
            <div className="grid gap-4">
              <DesktopEnvironmentHostsCard hosts={hosts} loading={hostsInitialLoading} />
              <RuntimeDefaultsCard
                isSupported={runtimeDefaults.runtimeDefaultsSupported}
                currentDefaultImageRef={runtimeDefaults.runtimeDefaultImageRef}
                draftDefaultImageRef={runtimeDefaults.runtimeDefaultImageDraft}
                draftReason={runtimeDefaults.runtimeDefaultReasonDraft}
                isLoading={runtimeDefaults.runtimeDefaultsMutation.isLoading}
                isRefreshing={runtimeDefaults.runtimeDefaultsLoading}
                loadError={runtimeDefaults.runtimeDefaultsError}
                saveError={runtimeDefaultsSaveError}
                onDefaultImageRefChange={runtimeDefaults.setRuntimeDefaultImageDraft}
                onReasonChange={runtimeDefaults.setRuntimeDefaultReasonDraft}
                onSave={runSaveRuntimeDefaults}
              />
              <CreateDesktopEnvironmentCard
                hosts={hosts}
                createHostId={createHostId}
                createLabel={createLabel}
                createImageRef={createImageRef}
                isLoading={mutation.isLoading}
                defaultImageRef={runtimeDefaults.runtimeDefaultImageRef}
                blockingMessage={blockingAvailabilityMessage}
                onHostChange={setCreateHostId}
                onLabelChange={setCreateLabel}
                onImageRefChange={setCreateImageRef}
                onCreate={runCreate}
              />
            </div>

            <div className="grid gap-4">
              <DesktopEnvironmentListCard
                environments={environments}
                hostById={hostById}
                selectedEnvironmentId={selectedEnvironmentId}
                loading={environmentsInitialLoading}
                onSelect={(environmentId) => {
                  setPendingSelectedEnvironmentId(null);
                  setSelectedEnvironmentId(environmentId);
                }}
              />
              <SelectedDesktopEnvironmentCard
                selectedEnvironment={selectedEnvironment}
                selectedHost={selectedHost}
                selectedLogs={selectedLogs}
                canStart={canStartSelectedEnvironment}
                startBlockedReason={selectedStartBlockedReason}
                isLoading={mutation.isLoading}
                isTakeoverLoading={takeover.isLoading}
                takeoverError={takeoverError}
                onOpenTakeover={
                  selectedEnvironment && selectedEnvironment.status === "running"
                    ? () => {
                        void takeover
                          .open({
                            environmentId: selectedEnvironment.environment_id,
                            title: selectedEnvironment.label ?? selectedEnvironment.environment_id,
                          })
                          .catch(() => {});
                      }
                    : undefined
                }
                onStart={() => {
                  if (!selectedEnvironment) return;
                  runAction(
                    async (httpClient) =>
                      await httpClient.desktopEnvironments.start(
                        selectedEnvironment.environment_id,
                      ),
                  );
                }}
                onStop={() => {
                  if (!selectedEnvironment) return;
                  runAction(
                    async (httpClient) =>
                      await httpClient.desktopEnvironments.stop(selectedEnvironment.environment_id),
                  );
                }}
                onReset={() => {
                  if (!selectedEnvironment) return;
                  runAction(
                    async (httpClient) =>
                      await httpClient.desktopEnvironments.reset(
                        selectedEnvironment.environment_id,
                      ),
                  );
                }}
                onRefreshLogs={() => {
                  if (!selectedEnvironment) return;
                  runRefreshLogs(selectedEnvironment.environment_id);
                }}
                onDelete={() => {
                  if (!selectedEnvironment) return;
                  runAction(async (httpClient) => {
                    await httpClient.desktopEnvironments.remove(selectedEnvironment.environment_id);
                    setPendingSelectedEnvironmentId(null);
                    setSelectedEnvironmentId(null);
                  });
                }}
              />
            </div>
          </div>
        )}
      </AppPage>
      <ManagedDesktopTakeoverDialog conversation={takeover.conversation} onClose={takeover.close} />
    </>
  );
}
