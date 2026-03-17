import type { SecretHandle } from "@tyrum/schemas";
import type { OperatorCore } from "@tyrum/operator-core";
import { KeyRound, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { EmptyState } from "../ui/empty-state.js";
import { Input } from "../ui/input.js";
import { LoadingState } from "../ui/loading-state.js";
import {
  useAdminHttpClient,
  useAdminMutationAccess,
  useAdminMutationHttpClient,
} from "./admin-http-shared.js";

type SecretsApi = OperatorCore["http"]["secrets"];
type SecretPanelMessage = {
  title: string;
  description: string;
};
type SecretRow = {
  handle: SecretHandle;
  secretKey: string;
  scopeLabel: string | null;
  filterText: string;
};

const MANAGED_PROVIDER_SECRET_PREFIX = "provider-account:";

function normalizeSecretRows(handles: SecretHandle[]): SecretRow[] {
  return handles
    .filter((handle) => !handle.handle_id.startsWith(MANAGED_PROVIDER_SECRET_PREFIX))
    .map((handle) => ({
      handle,
      secretKey: handle.handle_id,
      scopeLabel: handle.scope !== handle.handle_id ? handle.scope : null,
      filterText: `${handle.handle_id} ${handle.scope} ${handle.provider}`.toLowerCase(),
    }))
    .toSorted((left, right) => {
      const leftTime = Date.parse(left.handle.created_at);
      const rightTime = Date.parse(right.handle.created_at);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return left.secretKey.localeCompare(right.secretKey);
    });
}

function formatCreatedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function matchesSecretFilter(row: SecretRow, filterValue: string): boolean {
  const normalizedFilter = filterValue.trim().toLowerCase();
  if (!normalizedFilter) return true;
  return row.filterText.includes(normalizedFilter);
}

function SecretMetadata({ row }: { row: SecretRow }): React.ReactElement {
  return (
    <div className="grid gap-1 text-sm text-fg-muted">
      <div>
        <span className="font-medium text-fg">Secret key:</span>{" "}
        <span className="font-mono text-xs">{row.secretKey}</span>
      </div>
      {row.scopeLabel ? (
        <div>
          <span className="font-medium text-fg">Scope:</span>{" "}
          <span className="font-mono text-xs">{row.scopeLabel}</span>
        </div>
      ) : null}
      <div>
        <span className="font-medium text-fg">Provider:</span> {row.handle.provider}
      </div>
      <div>
        <span className="font-medium text-fg">Created:</span>{" "}
        {formatCreatedAt(row.handle.created_at)}
      </div>
    </div>
  );
}

function SecretRowActions({
  row,
  canMutate,
  requestEnter,
  onRotate,
  onRevoke,
}: {
  row: SecretRow;
  canMutate: boolean;
  requestEnter: () => void;
  onRotate: (row: SecretRow) => void;
  onRevoke: (row: SecretRow) => void;
}): React.ReactElement {
  return (
    <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
      <div className="flex items-center justify-start gap-1 md:justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          data-testid={`secret-rotate-open-${row.secretKey}`}
          aria-label={`Rotate ${row.secretKey}`}
          title="Rotate secret"
          onClick={() => {
            onRotate(row);
          }}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-error hover:bg-error/10 hover:text-error"
          data-testid={`secret-revoke-open-${row.secretKey}`}
          aria-label={`Revoke ${row.secretKey}`}
          title="Revoke secret"
          onClick={() => {
            onRevoke(row);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </ElevatedModeTooltip>
  );
}

export function AdminHttpSecretsPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const readHttp = useAdminHttpClient();
  const mutationHttp = useAdminMutationHttpClient();
  const readApi: SecretsApi = readHttp.secrets;
  const mutationApi: SecretsApi | null = mutationHttp?.secrets ?? null;
  const { canMutate, requestEnter } = useAdminMutationAccess(core);

  const [rows, setRows] = React.useState<SecretRow[]>([]);
  const [filterValue, setFilterValue] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<SecretPanelMessage | null>(null);
  const [storeOpen, setStoreOpen] = React.useState(false);
  const [storeSecretKeyRaw, setStoreSecretKeyRaw] = React.useState("");
  const [storeValueRaw, setStoreValueRaw] = React.useState("");
  const [rotateTarget, setRotateTarget] = React.useState<SecretRow | null>(null);
  const [rotateValueRaw, setRotateValueRaw] = React.useState("");
  const [revokeTarget, setRevokeTarget] = React.useState<SecretRow | null>(null);

  const refreshSecrets = React.useCallback(async (): Promise<void> => {
    setRefreshing(true);
    setErrorMessage(null);
    try {
      const result = await readApi.list();
      setRows(normalizeSecretRows(result.handles));
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [readApi]);

  React.useEffect(() => {
    void refreshSecrets();
  }, [refreshSecrets]);

  const filteredRows = React.useMemo(
    () => rows.filter((row) => matchesSecretFilter(row, filterValue)),
    [filterValue, rows],
  );
  const canStore = storeSecretKeyRaw.trim().length > 0 && storeValueRaw.trim().length > 0;
  const canRotate = rotateValueRaw.trim().length > 0;

  const runStore = async (): Promise<void> => {
    if (!canMutate) {
      requestEnter();
      throw new Error("Authorize admin access to store secrets.");
    }

    const secretKey = storeSecretKeyRaw.trim();
    if (!secretKey) {
      throw new Error("secret_key is required");
    }

    const rawValue = storeValueRaw;
    if (rawValue.trim().length === 0) {
      throw new Error("value is required");
    }

    if (!mutationApi) {
      throw new Error("Admin access is required to store secrets.");
    }
    await mutationApi.store({ secret_key: secretKey, value: rawValue });
    await refreshSecrets();
    setStoreSecretKeyRaw("");
    setStoreValueRaw("");
    setStatusMessage({
      title: "Secret stored",
      description: `Stored secret "${secretKey}".`,
    });
  };

  const runRotate = async (): Promise<void> => {
    if (!canMutate) {
      requestEnter();
      throw new Error("Authorize admin access to rotate secrets.");
    }
    if (!rotateTarget) {
      throw new Error("Select a secret to rotate.");
    }

    const rawValue = rotateValueRaw;
    if (rawValue.trim().length === 0) {
      throw new Error("value is required");
    }

    if (!mutationApi) {
      throw new Error("Admin access is required to rotate secrets.");
    }
    await mutationApi.rotate(rotateTarget.handle.handle_id, { value: rawValue });
    await refreshSecrets();
    setRotateValueRaw("");
    setStatusMessage({
      title: "Secret rotated",
      description: `Rotated secret "${rotateTarget.secretKey}".`,
    });
  };

  const runRevoke = async (): Promise<void> => {
    if (!canMutate) {
      requestEnter();
      throw new Error("Authorize admin access to revoke secrets.");
    }
    if (!revokeTarget) {
      throw new Error("Select a secret to revoke.");
    }

    if (!mutationApi) {
      throw new Error("Admin access is required to revoke secrets.");
    }
    await mutationApi.revoke(revokeTarget.handle.handle_id);
    await refreshSecrets();
    setStatusMessage({
      title: "Secret revoked",
      description: `Revoked secret "${revokeTarget.secretKey}".`,
    });
  };

  return (
    <section className="grid gap-4" data-testid="admin-http-secrets">
      <Alert
        variant="info"
        title="Write-only secrets"
        description="Secret values are never shown again after submission. Provider-managed credentials stay in Providers and do not appear in this list."
      />

      {statusMessage ? (
        <Alert
          variant="success"
          title={statusMessage.title}
          description={statusMessage.description}
        />
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <div className="text-sm font-medium text-fg">Secrets</div>
              <div className="text-sm text-fg-muted">
                Manage active operator secrets with structured metadata only.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{filteredRows.length} visible</Badge>
              <Badge variant="outline">{rows.length} total</Badge>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="admin-http-secrets-refresh"
                isLoading={refreshing}
                onClick={() => {
                  void refreshSecrets();
                }}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
                <Button
                  type="button"
                  size="sm"
                  data-testid="admin-http-secrets-store-open"
                  onClick={() => {
                    setStoreOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Store secret
                </Button>
              </ElevatedModeTooltip>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="max-w-xl">
            <Input
              label="Filter secrets"
              data-testid="admin-http-secrets-filter"
              value={filterValue}
              placeholder="Search by secret key, scope, or provider"
              onChange={(event) => {
                setFilterValue(event.currentTarget.value);
              }}
            />
          </div>

          {errorMessage ? (
            <Alert variant="error" title="Failed to load secrets" description={errorMessage} />
          ) : null}

          {loading ? <LoadingState label="Loading secrets…" /> : null}

          {!loading && !errorMessage && rows.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title="No secrets stored"
              description="Store a secret to create the first operator-managed secret handle."
              action={{
                label: canMutate ? "Store secret" : "Unlock changes",
                onClick: () => {
                  if (canMutate) {
                    setStoreOpen(true);
                    return;
                  }
                  requestEnter();
                },
              }}
            />
          ) : null}

          {!loading && !errorMessage && rows.length > 0 && filteredRows.length === 0 ? (
            <Alert
              variant="info"
              title="No secrets match the current filter"
              description="Adjust the filter to see more secrets."
            />
          ) : null}

          {!loading && !errorMessage && filteredRows.length > 0 ? (
            <div className="grid gap-2" role="table" aria-label="Secrets list">
              <div
                className="hidden items-center gap-4 rounded-lg border border-border bg-bg-subtle/60 px-4 py-2 text-xs font-medium uppercase tracking-wide text-fg-muted md:grid md:grid-cols-[minmax(0,1.8fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto]"
                role="row"
              >
                <div role="columnheader">Secret key</div>
                <div role="columnheader">Provider</div>
                <div role="columnheader">Created</div>
                <div className="text-right" role="columnheader">
                  Actions
                </div>
              </div>

              {filteredRows.map((row) => (
                <div
                  key={row.secretKey}
                  className="grid gap-3 rounded-lg border border-border bg-bg px-4 py-3 md:grid-cols-[minmax(0,1.8fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] md:items-center md:gap-4"
                  data-testid={`secret-row-${row.secretKey}`}
                  role="row"
                >
                  <div className="min-w-0" role="cell">
                    <div className="font-mono text-sm text-fg [overflow-wrap:anywhere]">
                      {row.secretKey}
                    </div>
                    {row.scopeLabel ? (
                      <div className="mt-1 text-xs text-fg-muted [overflow-wrap:anywhere]">
                        Scope: <span className="font-mono">{row.scopeLabel}</span>
                      </div>
                    ) : null}
                  </div>

                  <div role="cell">
                    <Badge variant="outline">{row.handle.provider}</Badge>
                  </div>

                  <div className="text-sm text-fg-muted" role="cell" title={row.handle.created_at}>
                    {formatCreatedAt(row.handle.created_at)}
                  </div>

                  <div role="cell">
                    <SecretRowActions
                      row={row}
                      canMutate={canMutate}
                      requestEnter={requestEnter}
                      onRotate={(nextRow) => {
                        setRotateTarget(nextRow);
                        setRotateValueRaw("");
                      }}
                      onRevoke={(nextRow) => {
                        setRevokeTarget(nextRow);
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ConfirmDangerDialog
        open={storeOpen}
        onOpenChange={(open) => {
          setStoreOpen(open);
          if (!open) {
            setStoreValueRaw("");
          }
        }}
        title="Store secret"
        description="Create a new write-only secret value. Existing secret keys must be rotated instead."
        confirmLabel="Store secret"
        confirmationLabel="I understand the value is write-only and will not be shown again."
        confirmDisabled={!canStore}
        onConfirm={runStore}
      >
        <div className="grid gap-4">
          <Input
            label="Secret key"
            required
            value={storeSecretKeyRaw}
            helperText="Use a unique key without whitespace."
            onChange={(event) => {
              setStoreSecretKeyRaw(event.currentTarget.value);
            }}
          />
          <Input
            label="Value"
            type="password"
            required
            placeholder="Write-only"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            value={storeValueRaw}
            onChange={(event) => {
              setStoreValueRaw(event.currentTarget.value);
            }}
          />
        </div>
      </ConfirmDangerDialog>

      <ConfirmDangerDialog
        open={rotateTarget !== null}
        onOpenChange={(open) => {
          if (open) return;
          setRotateTarget(null);
          setRotateValueRaw("");
        }}
        title="Rotate secret"
        description="Replace the current value for this secret key without exposing the existing value."
        confirmLabel="Rotate secret"
        confirmationLabel="I understand this replaces the current secret value."
        confirmDisabled={!canRotate}
        onConfirm={runRotate}
      >
        {rotateTarget ? (
          <div className="grid gap-4" data-testid="secrets-rotate-card">
            <SecretMetadata row={rotateTarget} />
            <Input
              label="New value"
              type="password"
              required
              placeholder="Write-only"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              value={rotateValueRaw}
              onChange={(event) => {
                setRotateValueRaw(event.currentTarget.value);
              }}
            />
          </div>
        ) : null}
      </ConfirmDangerDialog>

      <ConfirmDangerDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (open) return;
          setRevokeTarget(null);
        }}
        title="Revoke secret"
        description="Revoking a secret invalidates the selected handle immediately."
        confirmLabel="Revoke secret"
        confirmationLabel="I understand this invalidates the selected secret immediately."
        onConfirm={runRevoke}
      >
        {revokeTarget ? <SecretMetadata row={revokeTarget} /> : null}
      </ConfirmDangerDialog>
    </section>
  );
}
