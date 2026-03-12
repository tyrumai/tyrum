import type { OperatorCore } from "@tyrum/operator-core";
import type {
  DesktopEnvironmentGetResult,
  DesktopEnvironmentHostListResult,
} from "@tyrum/client/browser";
import { Boxes, Play, RefreshCw, RotateCcw, Square, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  buildTakeoverHref,
  DEFAULT_IMAGE_REF,
  environmentStatusVariant,
  hostStatusVariant,
} from "./desktop-environments-page.shared.js";
import { useApiAction } from "../../hooks/use-api-action.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { AppPage } from "../layout/app-page.js";
import { useAdminHttpClient, useAdminMutationAccess } from "./admin-http-shared.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { Textarea } from "../ui/textarea.js";

type DesktopEnvironment = DesktopEnvironmentGetResult["environment"];
type DesktopEnvironmentHost = DesktopEnvironmentHostListResult["hosts"][number];

export function DesktopEnvironmentsPage({ core }: { core: OperatorCore }) {
  const hostsState = useOperatorStore(core.desktopEnvironmentHostsStore);
  const environmentsState = useOperatorStore(core.desktopEnvironmentsStore);
  const adminHttp = useAdminHttpClient();
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const refreshAction = useApiAction<void>();
  const mutation = useApiAction<unknown>();
  const mutationHttp = adminHttp ?? core.http;

  const hosts = useMemo(
    () =>
      hostsState.orderedIds
        .map((hostId) => hostsState.byId[hostId])
        .filter((host): host is DesktopEnvironmentHost => Boolean(host)),
    [hostsState.byId, hostsState.orderedIds],
  );
  const environments = useMemo(
    () =>
      environmentsState.orderedIds
        .map((environmentId) => environmentsState.byId[environmentId])
        .filter((environment): environment is DesktopEnvironment => Boolean(environment)),
    [environmentsState.byId, environmentsState.orderedIds],
  );

  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(null);
  const [pendingSelectedEnvironmentId, setPendingSelectedEnvironmentId] = useState<string | null>(
    null,
  );
  const [createHostId, setCreateHostId] = useState<string>("");
  const [createLabel, setCreateLabel] = useState("");
  const [createImageRef, setCreateImageRef] = useState(DEFAULT_IMAGE_REF);

  useEffect(() => {
    const firstHostId = hosts[0]?.host_id;
    if (createHostId.length === 0 && firstHostId) setCreateHostId(firstHostId);
  }, [createHostId, hosts]);

  useEffect(() => {
    if (pendingSelectedEnvironmentId) {
      if (!environmentsState.byId[pendingSelectedEnvironmentId]) return;
      setSelectedEnvironmentId(pendingSelectedEnvironmentId);
      setPendingSelectedEnvironmentId(null);
      return;
    }
    if (selectedEnvironmentId && environmentsState.byId[selectedEnvironmentId]) return;
    setSelectedEnvironmentId(environments[0]?.environment_id ?? null);
  }, [environments, environmentsState.byId, pendingSelectedEnvironmentId, selectedEnvironmentId]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        await Promise.all([
          core.desktopEnvironmentHostsStore.refresh(),
          core.desktopEnvironmentsStore.refresh(),
        ]);
      } catch {
        if (cancelled) return;
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [core.desktopEnvironmentHostsStore, core.desktopEnvironmentsStore]);

  const selectedEnvironment = selectedEnvironmentId
    ? (environmentsState.byId[selectedEnvironmentId] ?? null)
    : null;
  const selectedLogs = selectedEnvironmentId
    ? environmentsState.logsById[selectedEnvironmentId]
    : undefined;
  const selectedHost = selectedEnvironment
    ? (hostsState.byId[selectedEnvironment.host_id] ?? null)
    : null;

  function requireMutation(action: () => void): void {
    if (!canMutate) {
      requestEnter();
      return;
    }
    action();
  }

  function runRefresh(): void {
    void refreshAction.run(async () => {
      await Promise.all([
        core.desktopEnvironmentHostsStore.refresh(),
        core.desktopEnvironmentsStore.refresh(),
      ]);
    });
  }

  function runCreate(): void {
    requireMutation(() => {
      void mutation.run(async () => {
        const created = await mutationHttp.desktopEnvironments.create({
          host_id: createHostId,
          label: createLabel.trim() || undefined,
          image_ref: createImageRef.trim() || DEFAULT_IMAGE_REF,
          desired_running: false,
        });
        const createdEnvironmentId = created.environment.environment_id;
        setPendingSelectedEnvironmentId(createdEnvironmentId);
        setCreateLabel("");
        try {
          await core.desktopEnvironmentsStore.refresh();
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

  function runAction(action: () => Promise<unknown>): void {
    requireMutation(() => {
      void mutation.run(async () => {
        const result = await action();
        await core.desktopEnvironmentsStore.refresh();
        return result;
      });
    });
  }

  function runRefreshLogs(environmentId: string): void {
    void mutation.run(async () => {
      await core.desktopEnvironmentsStore.refreshLogs(environmentId);
    });
  }

  return (
    <AppPage
      title="Desktop Environments"
      actions={
        <Button
          variant="outline"
          size="sm"
          isLoading={refreshAction.isLoading}
          disabled={refreshAction.isLoading}
          onClick={runRefresh}
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      }
      contentClassName="max-w-6xl gap-4"
      data-testid="desktop-environments-page"
    >
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 text-base font-semibold text-fg">
            <Boxes className="h-4 w-4" />
            Gateway-managed desktop environments
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="text-sm text-fg-muted">
            Create, start, stop, reset, and inspect Docker-backed desktop environments from the
            gateway control plane.
          </div>
          {hostsState.error || environmentsState.error ? (
            <Alert
              variant="error"
              title="Failed to load desktop environments"
              description={hostsState.error ?? environmentsState.error ?? undefined}
            />
          ) : null}
          {mutation.error ? (
            <Alert
              variant="error"
              title="Last action failed"
              description={
                mutation.error instanceof Error ? mutation.error.message : String(mutation.error)
              }
            />
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1.8fr]">
        <div className="grid gap-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="text-sm font-medium text-fg">Runtime hosts</div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {hosts.length === 0 ? (
                <div className="text-sm text-fg-muted">
                  No desktop runtime hosts are registered.
                </div>
              ) : null}
              {hosts.map((host) => (
                <div
                  key={host.host_id}
                  className="rounded-lg border border-border bg-surface-subtle px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-fg">{host.label}</div>
                      <div className="truncate text-xs text-fg-muted">{host.host_id}</div>
                    </div>
                    <Badge variant={hostStatusVariant(host)}>
                      {host.healthy ? "healthy" : "degraded"}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-fg-muted">
                    <span>{host.version ?? "unknown version"}</span>
                    <span>{host.docker_available ? "docker ready" : "docker unavailable"}</span>
                    <span>
                      {host.last_seen_at
                        ? `seen ${formatRelativeTime(host.last_seen_at)}`
                        : "never seen"}
                    </span>
                  </div>
                  {host.last_error ? (
                    <div className="mt-2 text-xs text-error">{host.last_error}</div>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="text-sm font-medium text-fg">Create desktop environment</div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Select
                label="Runtime host"
                value={createHostId}
                onChange={(event) => {
                  setCreateHostId(event.target.value);
                }}
                disabled={hosts.length === 0 || mutation.isLoading}
              >
                {hosts.map((host) => (
                  <option key={host.host_id} value={host.host_id}>
                    {host.label}
                  </option>
                ))}
              </Select>
              <Input
                label="Label"
                value={createLabel}
                onChange={(event) => {
                  setCreateLabel(event.target.value);
                }}
                placeholder="Research desktop"
                disabled={mutation.isLoading}
              />
              <Input
                label="Image ref"
                value={createImageRef}
                onChange={(event) => {
                  setCreateImageRef(event.target.value);
                }}
                placeholder={DEFAULT_IMAGE_REF}
                disabled={mutation.isLoading}
              />
              <Button
                disabled={
                  hosts.length === 0 || mutation.isLoading || createHostId.trim().length === 0
                }
                isLoading={mutation.isLoading}
                onClick={runCreate}
                data-testid="desktop-environments-create-button"
              >
                Create
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="text-sm font-medium text-fg">Desktop environments</div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {environments.length === 0 ? (
                <div className="text-sm text-fg-muted">
                  No desktop environments have been created yet.
                </div>
              ) : null}
              {environments.map((environment) => {
                const host = hostsState.byId[environment.host_id];
                const selected = environment.environment_id === selectedEnvironmentId;
                return (
                  <button
                    key={environment.environment_id}
                    type="button"
                    className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                      selected
                        ? "border-accent bg-accent/10"
                        : "border-border bg-surface-subtle hover:bg-surface"
                    }`}
                    onClick={() => {
                      setPendingSelectedEnvironmentId(null);
                      setSelectedEnvironmentId(environment.environment_id);
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-fg">
                          {environment.label ?? environment.environment_id}
                        </div>
                        <div className="truncate text-xs text-fg-muted">
                          {host?.label ?? environment.host_id}
                        </div>
                      </div>
                      <Badge variant={environmentStatusVariant(environment.status)}>
                        {environment.status}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-fg-muted">
                      <span>{environment.managed_kind}</span>
                      <span>{environment.desired_running ? "desired on" : "desired off"}</span>
                      <span>
                        {environment.last_seen_at
                          ? `seen ${formatRelativeTime(environment.last_seen_at)}`
                          : "not yet seen"}
                      </span>
                    </div>
                    {environment.last_error ? (
                      <div className="mt-2 text-xs text-error">{environment.last_error}</div>
                    ) : null}
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="text-sm font-medium text-fg">Selected environment</div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {!selectedEnvironment ? (
                <div className="text-sm text-fg-muted">Select an environment to inspect it.</div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={environmentStatusVariant(selectedEnvironment.status)}>
                      {selectedEnvironment.status}
                    </Badge>
                    <Badge variant="outline">{selectedEnvironment.managed_kind}</Badge>
                    <Badge variant="outline">
                      {selectedHost?.label ?? selectedEnvironment.host_id}
                    </Badge>
                  </div>
                  <div className="grid gap-1 text-sm text-fg-muted">
                    <div>{selectedEnvironment.image_ref}</div>
                    <div>{selectedEnvironment.node_id ?? "node not connected yet"}</div>
                    <div>
                      {selectedEnvironment.takeover_url ? (
                        <a
                          href={
                            buildTakeoverHref(
                              core.httpBaseUrl,
                              selectedEnvironment.environment_id,
                            ) ?? selectedEnvironment.takeover_url
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="text-fg underline underline-offset-4"
                          data-testid={`desktop-environment-takeover-${selectedEnvironment.environment_id}`}
                        >
                          Open takeover
                        </a>
                      ) : (
                        "Takeover unavailable"
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={mutation.isLoading}
                      onClick={() => {
                        runAction(
                          async () =>
                            await mutationHttp.desktopEnvironments.start(
                              selectedEnvironment.environment_id,
                            ),
                        );
                      }}
                      data-testid={`desktop-environment-start-${selectedEnvironment.environment_id}`}
                    >
                      <Play className="h-4 w-4" />
                      Start
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={mutation.isLoading}
                      onClick={() => {
                        runAction(
                          async () =>
                            await mutationHttp.desktopEnvironments.stop(
                              selectedEnvironment.environment_id,
                            ),
                        );
                      }}
                      data-testid={`desktop-environment-stop-${selectedEnvironment.environment_id}`}
                    >
                      <Square className="h-4 w-4" />
                      Stop
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={mutation.isLoading}
                      onClick={() => {
                        runAction(
                          async () =>
                            await mutationHttp.desktopEnvironments.reset(
                              selectedEnvironment.environment_id,
                            ),
                        );
                      }}
                      data-testid={`desktop-environment-reset-${selectedEnvironment.environment_id}`}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Reset
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={mutation.isLoading}
                      onClick={() => {
                        runRefreshLogs(selectedEnvironment.environment_id);
                      }}
                      data-testid={`desktop-environment-logs-button-${selectedEnvironment.environment_id}`}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Logs
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={mutation.isLoading}
                      onClick={() => {
                        runAction(async () => {
                          await mutationHttp.desktopEnvironments.remove(
                            selectedEnvironment.environment_id,
                          );
                          setPendingSelectedEnvironmentId(null);
                          setSelectedEnvironmentId(null);
                        });
                      }}
                      data-testid={`desktop-environment-delete-${selectedEnvironment.environment_id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                  <Textarea
                    readOnly
                    value={
                      selectedLogs?.lines.length
                        ? selectedLogs.lines.join("\n")
                        : "No logs loaded yet."
                    }
                    helperText={
                      selectedLogs?.lastSyncedAt
                        ? `Last synced ${formatRelativeTime(selectedLogs.lastSyncedAt)}`
                        : (selectedLogs?.error ?? "Use Logs to fetch recent container output.")
                    }
                    className="min-h-56 font-mono text-xs"
                    data-testid={`desktop-environment-logs-${selectedEnvironment.environment_id}`}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppPage>
  );
}
