import type { OperatorCore } from "@tyrum/operator-core";
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_IMAGE_REF } from "./desktop-environments-page.shared.js";
import {
  CreateDesktopEnvironmentCard,
  DesktopEnvironmentsSummaryCard,
  DesktopEnvironmentHostsCard,
  DesktopEnvironmentListCard,
  SelectedDesktopEnvironmentCard,
  type DesktopEnvironment,
  type DesktopEnvironmentHost,
  type DesktopEnvironmentLogsState,
} from "./desktop-environments-page.sections.js";
import { useApiAction } from "../../hooks/use-api-action.js";
import { AppPage } from "../layout/app-page.js";
import {
  AdminAccessGateCard,
  AdminMutationGate,
  isAdminAccessHttpError,
  useAdminHttpClient,
  useAdminMutationAccess,
  type AdminHttpClient,
} from "./admin-http-shared.js";
import { Button } from "../ui/button.js";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}

export function DesktopEnvironmentsPage({ core }: { core: OperatorCore }) {
  const adminHttp = useAdminHttpClient({ access: "strict" });
  const adminHttpRef = useRef<AdminHttpClient | null>(adminHttp);
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const refreshAction = useApiAction<void>();
  const mutation = useApiAction<unknown>();

  const [hosts, setHosts] = useState<readonly DesktopEnvironmentHost[]>([]);
  const [hostsLoading, setHostsLoading] = useState(false);
  const [hostsError, setHostsError] = useState<string | null>(null);
  const [environments, setEnvironments] = useState<readonly DesktopEnvironment[]>([]);
  const [environmentsLoading, setEnvironmentsLoading] = useState(false);
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

  useEffect(() => {
    const firstHostId = hosts[0]?.host_id;
    if (createHostId.length === 0 && firstHostId) setCreateHostId(firstHostId);
  }, [createHostId, hosts]);

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

  async function refreshHosts(httpClient: AdminHttpClient): Promise<void> {
    setHostsLoading(true);
    setHostsError(null);
    try {
      const result = await httpClient.desktopEnvironmentHosts.list();
      if (adminHttpRef.current !== httpClient) return;
      setHosts(result.hosts);
      setHostsError(null);
      setRequiresAdminAccess(false);
    } catch (error) {
      if (adminHttpRef.current !== httpClient) return;
      if (isAdminAccessHttpError(error)) {
        core.elevatedModeStore.exit();
        setRequiresAdminAccess(true);
        setHostsError(null);
        return;
      }
      setHostsError(toErrorMessage(error));
    } finally {
      if (adminHttpRef.current === httpClient) {
        setHostsLoading(false);
      }
    }
  }

  async function refreshEnvironments(httpClient: AdminHttpClient): Promise<void> {
    setEnvironmentsLoading(true);
    setEnvironmentsError(null);
    try {
      const result = await httpClient.desktopEnvironments.list();
      if (adminHttpRef.current !== httpClient) return;
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
      setRequiresAdminAccess(false);
    } catch (error) {
      if (adminHttpRef.current !== httpClient) return;
      if (isAdminAccessHttpError(error)) {
        core.elevatedModeStore.exit();
        setRequiresAdminAccess(true);
        setEnvironmentsError(null);
        return;
      }
      setEnvironmentsError(toErrorMessage(error));
    } finally {
      if (adminHttpRef.current === httpClient) {
        setEnvironmentsLoading(false);
      }
    }
  }

  async function refreshPageData(httpClient: AdminHttpClient): Promise<void> {
    await Promise.all([refreshHosts(httpClient), refreshEnvironments(httpClient)]);
  }

  useEffect(() => {
    if (!adminHttp) {
      setHosts([]);
      setHostsLoading(false);
      setHostsError(null);
      setEnvironments([]);
      setEnvironmentsLoading(false);
      setEnvironmentsError(null);
      setLogsById({});
      setSelectedEnvironmentId(null);
      setPendingSelectedEnvironmentId(null);
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

  function requireMutation(action: () => void): void {
    if (!canMutate) {
      requestEnter();
      return;
    }
    action();
  }

  function requireAdminHttp(): AdminHttpClient {
    const httpClient = adminHttpRef.current;
    if (!httpClient) {
      throw new Error("Authorize admin access to continue.");
    }
    return httpClient;
  }

  function runRefresh(): void {
    const httpClient = adminHttpRef.current;
    if (!httpClient) {
      requestEnter();
      return;
    }
    void refreshAction.run(async () => {
      await refreshPageData(httpClient);
    });
  }

  function runCreate(): void {
    requireMutation(() => {
      void mutation.run(async () => {
        const httpClient = requireAdminHttp();
        const created = await httpClient.desktopEnvironments.create({
          host_id: createHostId,
          label: createLabel.trim() || undefined,
          image_ref: createImageRef.trim() || DEFAULT_IMAGE_REF,
          desired_running: false,
        });
        const createdEnvironmentId = created.environment.environment_id;
        setPendingSelectedEnvironmentId(createdEnvironmentId);
        setCreateLabel("");
        try {
          await refreshEnvironments(httpClient);
        } catch (error) {
          setPendingSelectedEnvironmentId((current) =>
            current === createdEnvironmentId ? null : current,
          );
          throw error;
        }
        return created.environment;
      });
    });
  }

  function runAction(action: (httpClient: AdminHttpClient) => Promise<unknown>): void {
    requireMutation(() => {
      void mutation.run(async () => {
        const httpClient = requireAdminHttp();
        const result = await action(httpClient);
        await refreshEnvironments(httpClient);
        return result;
      });
    });
  }

  function runRefreshLogs(environmentId: string): void {
    const httpClient = adminHttpRef.current;
    if (!httpClient) {
      requestEnter();
      return;
    }

    void mutation.run(async () => {
      setLogsById((current) => ({
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
        if (adminHttpRef.current !== httpClient) return;
        setLogsById((current) => ({
          ...current,
          [environmentId]: {
            lines: result.logs,
            loading: false,
            error: null,
            lastSyncedAt: new Date().toISOString(),
          },
        }));
      } catch (error) {
        if (adminHttpRef.current !== httpClient) return;
        setLogsById((current) => ({
          ...current,
          [environmentId]: {
            lines: current[environmentId]?.lines ?? [],
            loading: false,
            error: toErrorMessage(error),
            lastSyncedAt: current[environmentId]?.lastSyncedAt ?? null,
          },
        }));
        throw error;
      }
    });
  }

  return (
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
        mutationError={mutation.error ? toErrorMessage(mutation.error) : null}
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
            <DesktopEnvironmentHostsCard hosts={hosts} />
            <CreateDesktopEnvironmentCard
              hosts={hosts}
              createHostId={createHostId}
              createLabel={createLabel}
              createImageRef={createImageRef}
              isLoading={mutation.isLoading}
              defaultImageRef={DEFAULT_IMAGE_REF}
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
              onSelect={(environmentId) => {
                setPendingSelectedEnvironmentId(null);
                setSelectedEnvironmentId(environmentId);
              }}
            />
            <SelectedDesktopEnvironmentCard
              coreHttpBaseUrl={core.httpBaseUrl}
              selectedEnvironment={selectedEnvironment}
              selectedHost={selectedHost}
              selectedLogs={selectedLogs}
              isLoading={mutation.isLoading}
              onStart={() => {
                if (!selectedEnvironment) return;
                runAction(
                  async (httpClient) =>
                    await httpClient.desktopEnvironments.start(selectedEnvironment.environment_id),
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
                    await httpClient.desktopEnvironments.reset(selectedEnvironment.environment_id),
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
  );
}
