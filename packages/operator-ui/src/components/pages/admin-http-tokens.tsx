import type { OperatorCore } from "@tyrum/operator-core";
import type { AuthTokenListEntry } from "@tyrum/client/browser";
import * as React from "react";
import { toast } from "sonner";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { useAdminHttpClient, useAdminMutationAccess } from "./admin-http-shared.js";
import { IssuedTokenNotice, SummaryBadge } from "./admin-http-tokens-display.js";
import { TokenResults } from "./admin-http-tokens-results.js";
import {
  type AuthTokenIssueResult,
  buildIssueInput,
  buildUpdateInput,
  defaultFormState,
  formatAccessSummary,
  formStateFromToken,
  matchesQuery,
  type DialogMode,
  type TokenFormState,
  type TokenRole,
  type TokenStatusFilter,
  sortVisibleTokens,
  TokenDialog,
  tokenStatus,
  validateForm,
} from "./admin-http-tokens-shared.js";

export function AuthTokensCard({ core }: { core: OperatorCore }): React.ReactElement {
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const adminHttp = useAdminHttpClient({ access: "strict" });
  const [tokens, setTokens] = React.useState<AuthTokenListEntry[]>([]);
  const [listBusy, setListBusy] = React.useState(true);
  const [listErrorMessage, setListErrorMessage] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<TokenStatusFilter>("all");
  const [roleFilter, setRoleFilter] = React.useState<"all" | TokenRole>("all");
  const [dialogMode, setDialogMode] = React.useState<DialogMode | null>(null);
  const [editingToken, setEditingToken] = React.useState<AuthTokenListEntry | null>(null);
  const [initialEditExpirationState, setInitialEditExpirationState] = React.useState<Pick<
    TokenFormState,
    "expirationPreset" | "customExpiresAt"
  > | null>(null);
  const [formState, setFormState] = React.useState(defaultFormState());
  const [dialogBusy, setDialogBusy] = React.useState(false);
  const [issuedToken, setIssuedToken] = React.useState<AuthTokenIssueResult | null>(null);
  const [revokeTarget, setRevokeTarget] = React.useState<AuthTokenListEntry | null>(null);

  const loadTokens = React.useCallback(async () => {
    if (!adminHttp) {
      setTokens([]);
      setListBusy(false);
      setListErrorMessage("Admin access is required to load tenant tokens.");
      return;
    }
    setListBusy(true);
    setListErrorMessage(null);
    try {
      const result = await adminHttp.authTokens.list();
      setTokens(result.tokens);
    } catch (error) {
      setListErrorMessage(error instanceof Error ? error.message : "Failed to load tokens.");
      setTokens([]);
    } finally {
      setListBusy(false);
    }
  }, [adminHttp]);

  React.useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  const visibleTokens = React.useMemo(() => {
    const filtered = tokens.filter((token) => {
      if (!matchesQuery(token, searchQuery.trim())) return false;
      if (statusFilter !== "all" && tokenStatus(token) !== statusFilter) return false;
      if (roleFilter !== "all" && token.role !== roleFilter) return false;
      return true;
    });
    return sortVisibleTokens(filtered);
  }, [roleFilter, searchQuery, statusFilter, tokens]);

  const counts = React.useMemo(
    () => ({
      total: tokens.length,
      active: tokens.filter((token) => tokenStatus(token) === "active").length,
      expired: tokens.filter((token) => tokenStatus(token) === "expired").length,
      revoked: tokens.filter((token) => tokenStatus(token) === "revoked").length,
    }),
    [tokens],
  );

  const openCreateDialog = () => {
    setDialogMode("create");
    setEditingToken(null);
    setInitialEditExpirationState(null);
    setFormState(defaultFormState());
    setIssuedToken(null);
  };

  const openEditDialog = (token: AuthTokenListEntry) => {
    const initialFormState = formStateFromToken(token);
    setDialogMode("edit");
    setEditingToken(token);
    setInitialEditExpirationState({
      expirationPreset: initialFormState.expirationPreset,
      customExpiresAt: initialFormState.customExpiresAt,
    });
    setFormState(initialFormState);
    setIssuedToken(null);
  };

  const closeDialog = (open: boolean) => {
    if (open) return;
    setDialogMode(null);
    setEditingToken(null);
    setInitialEditExpirationState(null);
    setDialogBusy(false);
  };

  const saveDialog = async (): Promise<void> => {
    if (!canMutate) {
      requestEnter();
      return;
    }
    const validationError = validateForm(formState, {
      initialExpiresAt: dialogMode === "edit" ? (editingToken?.expires_at ?? null) : null,
    });
    if (validationError) {
      toast.error("Unable to save token", { description: validationError });
      return;
    }

    setDialogBusy(true);
    try {
      if (dialogMode === "create") {
        if (!adminHttp) {
          throw new Error("Admin access is required to issue tenant tokens.");
        }
        setIssuedToken(await adminHttp.authTokens.issue(buildIssueInput(formState)));
      } else if (dialogMode === "edit" && editingToken) {
        if (!adminHttp) {
          throw new Error("Admin access is required to update tenant tokens.");
        }
        await adminHttp.authTokens.update(
          editingToken.token_id,
          buildUpdateInput(formState, {
            initialExpiresAt: editingToken.expires_at,
            initialExpirationPreset: initialEditExpirationState?.expirationPreset,
            initialCustomExpiresAt: initialEditExpirationState?.customExpiresAt,
          }),
        );
      }
      closeDialog(false);
      await loadTokens();
    } catch (error) {
      toast.error("Unable to save token", {
        description: error instanceof Error ? error.message : "Failed to save token.",
      });
    } finally {
      setDialogBusy(false);
    }
  };

  const revokeToken = async (): Promise<void> => {
    if (!canMutate) {
      requestEnter();
      throw new Error("Authorize admin access to revoke tokens.");
    }
    if (!revokeTarget) {
      throw new Error("Select a token to revoke.");
    }

    try {
      if (!adminHttp) {
        throw new Error("Admin access is required to revoke tenant tokens.");
      }
      const result = await adminHttp.authTokens.revoke({ token_id: revokeTarget.token_id });
      if (!result.revoked) {
        throw new Error("Token could not be revoked.");
      }
      setIssuedToken(null);
      await loadTokens();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to revoke token.";
      toast.error("Token revoke failed", { description: message });
    }
  };

  return (
    <Card data-testid="admin-http-tokens">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-medium text-fg">Tenant tokens</div>
            <p className="text-sm text-fg-muted">
              Filter existing tokens, create new ones with structured fields, and edit or revoke
              them in place.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SummaryBadge label="Visible" value={visibleTokens.length} />
            <SummaryBadge label="Total" value={counts.total} />
            <SummaryBadge label="Active" value={counts.active} />
            <SummaryBadge label="Expired" value={counts.expired} />
            <SummaryBadge label="Revoked" value={counts.revoked} />
            <Button
              type="button"
              variant="secondary"
              data-testid="admin-http-tokens-refresh"
              isLoading={listBusy}
              onClick={() => {
                void loadTokens();
              }}
            >
              Refresh
            </Button>
            <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
              <Button
                type="button"
                data-testid="admin-http-tokens-issue"
                onClick={openCreateDialog}
              >
                Add token
              </Button>
            </ElevatedModeTooltip>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-4">
        <Alert
          variant="info"
          title="Write-once secrets"
          description="Token secrets are shown once after creation and are never readable from the list."
        />

        {issuedToken ? (
          <IssuedTokenNotice
            token={issuedToken}
            gatewayHttpBaseUrl={core.httpBaseUrl}
            onDismiss={() => {
              setIssuedToken(null);
            }}
          />
        ) : null}

        {listErrorMessage ? (
          <Alert
            variant="error"
            title="Token list failed"
            description={listErrorMessage}
            onDismiss={() => setListErrorMessage(null)}
          />
        ) : null}

        <div className="grid gap-3 rounded-lg border border-border p-3 lg:grid-cols-[minmax(0,1fr)_12rem_12rem]">
          <Input
            label="Search"
            data-testid="admin-http-token-search"
            value={searchQuery}
            placeholder="Search by name, token ID, device ID, role, or scope"
            onChange={(event) => {
              setSearchQuery(event.currentTarget.value);
            }}
          />
          <Select
            label="Status"
            data-testid="admin-http-token-filter-status"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.currentTarget.value as TokenStatusFilter);
            }}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="revoked">Revoked</option>
          </Select>
          <Select
            label="Role"
            data-testid="admin-http-token-filter-role"
            value={roleFilter}
            onChange={(event) => {
              setRoleFilter(event.currentTarget.value as "all" | TokenRole);
            }}
          >
            <option value="all">All</option>
            <option value="admin">Admin</option>
            <option value="client">Client</option>
            <option value="node">Node</option>
          </Select>
        </div>

        <TokenResults
          listBusy={listBusy}
          tokens={tokens}
          visibleTokens={visibleTokens}
          canMutate={canMutate}
          requestEnter={requestEnter}
          onAddToken={openCreateDialog}
          onEditToken={openEditDialog}
          onRevokeToken={setRevokeTarget}
        />
      </CardContent>

      <TokenDialog
        open={dialogMode !== null}
        mode={dialogMode ?? "create"}
        state={formState}
        saving={dialogBusy}
        onOpenChange={closeDialog}
        onStateChange={setFormState}
        onSave={() => {
          void saveDialog();
        }}
      />

      <ConfirmDangerDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevokeTarget(null);
          }
        }}
        title="Revoke token"
        description={
          revokeTarget
            ? `Revoke ${revokeTarget.display_name} (${revokeTarget.token_id}). This invalidates the token immediately.`
            : undefined
        }
        confirmLabel="Revoke token"
        onConfirm={revokeToken}
      >
        {revokeTarget ? (
          <div className="grid gap-2 text-sm text-fg-muted">
            <div>
              <span className="font-medium text-fg">Role:</span> {revokeTarget.role}
            </div>
            <div>
              <span className="font-medium text-fg">Device:</span>{" "}
              {revokeTarget.device_id ?? "Optional"}
            </div>
            <div>
              <span className="font-medium text-fg">Access:</span>{" "}
              {formatAccessSummary(revokeTarget)}
            </div>
          </div>
        ) : null}
      </ConfirmDangerDialog>
    </Card>
  );
}
