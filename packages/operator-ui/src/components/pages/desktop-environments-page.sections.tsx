import type {
  DesktopEnvironmentGetResult,
  DesktopEnvironmentHostListResult,
} from "@tyrum/client/browser";
import { Boxes, Play, RefreshCw, RotateCcw, Square, Trash2 } from "lucide-react";
import {
  buildTakeoverHref,
  environmentStatusVariant,
  hostStatusVariant,
} from "./desktop-environments-page.shared.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { Textarea } from "../ui/textarea.js";

export type DesktopEnvironment = DesktopEnvironmentGetResult["environment"];
export type DesktopEnvironmentHost = DesktopEnvironmentHostListResult["hosts"][number];

export interface DesktopEnvironmentLogsState {
  lines: string[];
  loading: boolean;
  error: string | null;
  lastSyncedAt: string | null;
}

export function DesktopEnvironmentsSummaryCard({
  hostsError,
  environmentsError,
  mutationError,
}: {
  hostsError: string | null;
  environmentsError: string | null;
  mutationError: string | null;
}) {
  const hasLoadError = hostsError || environmentsError;

  return (
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
        {hasLoadError ? (
          <Alert
            variant="error"
            title="Failed to load desktop environments"
            description={hostsError ?? environmentsError ?? undefined}
          />
        ) : null}
        {mutationError ? (
          <Alert variant="error" title="Last action failed" description={mutationError} />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function DesktopEnvironmentHostsCard({
  hosts,
}: {
  hosts: readonly DesktopEnvironmentHost[];
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="text-sm font-medium text-fg">Runtime hosts</div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {hosts.length === 0 ? (
          <div className="text-sm text-fg-muted">No desktop runtime hosts are registered.</div>
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
                {host.last_seen_at ? `seen ${formatRelativeTime(host.last_seen_at)}` : "never seen"}
              </span>
            </div>
            {host.last_error ? (
              <div className="mt-2 text-xs text-error">{host.last_error}</div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function CreateDesktopEnvironmentCard({
  hosts,
  createHostId,
  createLabel,
  createImageRef,
  isLoading,
  defaultImageRef,
  onHostChange,
  onLabelChange,
  onImageRefChange,
  onCreate,
}: {
  hosts: readonly DesktopEnvironmentHost[];
  createHostId: string;
  createLabel: string;
  createImageRef: string;
  isLoading: boolean;
  defaultImageRef: string;
  onHostChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onImageRefChange: (value: string) => void;
  onCreate: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="text-sm font-medium text-fg">Create desktop environment</div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Select
          label="Runtime host"
          value={createHostId}
          onChange={(event) => {
            onHostChange(event.target.value);
          }}
          disabled={hosts.length === 0 || isLoading}
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
            onLabelChange(event.target.value);
          }}
          placeholder="Research desktop"
          disabled={isLoading}
        />
        <Input
          label="Image ref"
          value={createImageRef}
          onChange={(event) => {
            onImageRefChange(event.target.value);
          }}
          placeholder={defaultImageRef}
          disabled={isLoading}
        />
        <Button
          disabled={hosts.length === 0 || isLoading || createHostId.trim().length === 0}
          isLoading={isLoading}
          onClick={onCreate}
          data-testid="desktop-environments-create-button"
        >
          Create
        </Button>
      </CardContent>
    </Card>
  );
}

export function DesktopEnvironmentListCard({
  environments,
  hostById,
  selectedEnvironmentId,
  onSelect,
}: {
  environments: readonly DesktopEnvironment[];
  hostById: Record<string, DesktopEnvironmentHost>;
  selectedEnvironmentId: string | null;
  onSelect: (environmentId: string) => void;
}) {
  return (
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
          const host = hostById[environment.host_id];
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
                onSelect(environment.environment_id);
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
  );
}

export function SelectedDesktopEnvironmentCard({
  coreHttpBaseUrl,
  selectedEnvironment,
  selectedHost,
  selectedLogs,
  isLoading,
  onStart,
  onStop,
  onReset,
  onRefreshLogs,
  onDelete,
}: {
  coreHttpBaseUrl: string;
  selectedEnvironment: DesktopEnvironment | null;
  selectedHost: DesktopEnvironmentHost | null;
  selectedLogs: DesktopEnvironmentLogsState | undefined;
  isLoading: boolean;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  onRefreshLogs: () => void;
  onDelete: () => void;
}) {
  return (
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
              <Badge variant="outline">{selectedHost?.label ?? selectedEnvironment.host_id}</Badge>
            </div>
            <div className="grid gap-1 text-sm text-fg-muted">
              <div>{selectedEnvironment.image_ref}</div>
              <div>{selectedEnvironment.node_id ?? "node not connected yet"}</div>
              <div>
                {selectedEnvironment.takeover_url ? (
                  <a
                    href={
                      buildTakeoverHref(coreHttpBaseUrl, selectedEnvironment.environment_id) ??
                      selectedEnvironment.takeover_url
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
                disabled={isLoading}
                onClick={onStart}
                data-testid={`desktop-environment-start-${selectedEnvironment.environment_id}`}
              >
                <Play className="h-4 w-4" />
                Start
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isLoading}
                onClick={onStop}
                data-testid={`desktop-environment-stop-${selectedEnvironment.environment_id}`}
              >
                <Square className="h-4 w-4" />
                Stop
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isLoading}
                onClick={onReset}
                data-testid={`desktop-environment-reset-${selectedEnvironment.environment_id}`}
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isLoading || selectedLogs?.loading === true}
                onClick={onRefreshLogs}
                data-testid={`desktop-environment-logs-button-${selectedEnvironment.environment_id}`}
              >
                <RefreshCw className="h-4 w-4" />
                Logs
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={isLoading}
                onClick={onDelete}
                data-testid={`desktop-environment-delete-${selectedEnvironment.environment_id}`}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
            <Textarea
              readOnly
              value={
                selectedLogs?.lines.length ? selectedLogs.lines.join("\n") : "No logs loaded yet."
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
  );
}
