import type { OperatorCore } from "@tyrum/operator-core";
import type { AuthTokenListEntry } from "@tyrum/client/browser";
import * as React from "react";
import { Alert } from "../ui/alert.js";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js";
import { Separator } from "../ui/separator.js";
import { Textarea } from "../ui/textarea.js";
import { useAdminHttpClient, useAdminMutationAccess } from "./admin-http-shared.js";

type TokenRole = "admin" | "client" | "node";

function parseScopesInput(value: string): string[] {
  const scopes = value
    .split(/[\n,]+/g)
    .map((scope) => scope.trim())
    .filter(Boolean);
  return Array.from(new Set(scopes));
}

function statusVariant(token: AuthTokenListEntry): "success" | "warning" {
  return token.revoked_at ? "warning" : "success";
}

function statusLabel(token: AuthTokenListEntry): string {
  return token.revoked_at ? "Revoked" : "Active";
}

function formatTimestamp(value: string | null | undefined): string {
  return value ?? "Never";
}

function TokenListCard({
  tokens,
  busy,
  error,
  canMutate,
  onRefresh,
  onRevoke,
}: {
  tokens: AuthTokenListEntry[];
  busy: boolean;
  error: unknown;
  canMutate: boolean;
  onRefresh: () => Promise<void>;
  onRevoke: (token: AuthTokenListEntry) => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="grid gap-1">
            <div className="text-sm font-medium text-fg">Existing tokens</div>
            <div className="text-sm text-fg-muted">
              Token secrets are never shown here again after issuance.
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            data-testid="admin-http-tokens-refresh"
            isLoading={busy}
            onClick={() => {
              void onRefresh();
            }}
          >
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error ? <ApiResultCard heading="Token list" error={error} /> : null}
        {!error && tokens.length === 0 ? (
          <Alert
            variant="info"
            title="No tenant tokens yet"
            description="Issue a token below to create the first tenant-scoped token."
          />
        ) : null}
        {tokens.map((token) => (
          <div
            key={token.token_id}
            className="grid gap-3 rounded-lg border border-border p-4"
            data-testid={`admin-http-token-row-${token.token_id}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{token.role}</Badge>
              <Badge variant={statusVariant(token)}>{statusLabel(token)}</Badge>
              {token.device_id ? <Badge variant="outline">{token.device_id}</Badge> : null}
            </div>
            <div className="grid gap-1 text-sm text-fg-muted">
              <div>
                <span className="font-medium text-fg">Token ID:</span>{" "}
                <span className="font-mono text-xs">{token.token_id}</span>
              </div>
              <div>
                <span className="font-medium text-fg">Issued:</span>{" "}
                {formatTimestamp(token.issued_at)}
              </div>
              <div>
                <span className="font-medium text-fg">Expires:</span>{" "}
                {formatTimestamp(token.expires_at)}
              </div>
              <div>
                <span className="font-medium text-fg">Revoked:</span>{" "}
                {formatTimestamp(token.revoked_at)}
              </div>
              <div>
                <span className="font-medium text-fg">Scopes:</span>{" "}
                {token.scopes.length > 0 ? token.scopes.join(", ") : "(none)"}
              </div>
            </div>
            <div>
              <Button
                type="button"
                variant="danger"
                size="sm"
                data-testid={`admin-http-token-revoke-${token.token_id}`}
                disabled={!canMutate || Boolean(token.revoked_at)}
                onClick={() => {
                  onRevoke(token);
                }}
              >
                Revoke
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TokenIssueFields({
  role,
  setRole,
  deviceId,
  setDeviceId,
  scopes,
  setScopes,
  ttlSeconds,
  setTtlSeconds,
}: {
  role: TokenRole;
  setRole: (next: TokenRole) => void;
  deviceId: string;
  setDeviceId: (next: string) => void;
  scopes: string;
  setScopes: (next: string) => void;
  ttlSeconds: string;
  setTtlSeconds: (next: string) => void;
}) {
  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium leading-none text-fg">
          Role{" "}
          <span aria-hidden="true" className="text-error">
            *
          </span>
        </legend>
        <RadioGroup
          value={role}
          onValueChange={(value) => {
            if (value === "admin" || value === "client" || value === "node") {
              setRole(value);
            }
          }}
          className="grid gap-3"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem id="auth-token-role-admin" value="admin" />
            <Label htmlFor="auth-token-role-admin">Admin</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="auth-token-role-client" value="client" />
            <Label htmlFor="auth-token-role-client">Client</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="auth-token-role-node" value="node" />
            <Label htmlFor="auth-token-role-node">Node</Label>
          </div>
        </RadioGroup>
      </fieldset>

      <Input
        label="Device ID"
        value={deviceId}
        placeholder={role === "admin" ? "Optional" : "device-123"}
        helperText={
          role === "admin" ? "Optional for admin tokens." : "Recommended for client/node tokens."
        }
        onChange={(event) => {
          setDeviceId(event.currentTarget.value);
        }}
      />

      <Textarea
        label="Scopes"
        rows={3}
        value={scopes}
        placeholder={role === "admin" ? "*" : "operator.read\noperator.admin"}
        helperText="Comma or newline separated. Leave blank for no scopes."
        onChange={(event) => {
          setScopes(event.currentTarget.value);
        }}
      />

      <Input
        label="TTL (seconds)"
        type="number"
        inputMode="numeric"
        value={ttlSeconds}
        helperText="Leave blank to issue a persistent token."
        onChange={(event) => {
          setTtlSeconds(event.currentTarget.value);
        }}
      />
    </div>
  );
}

export function AuthTokensCard({ core }: { core: OperatorCore }): React.ReactElement {
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const http = useAdminHttpClient() ?? core.http;
  const [tokens, setTokens] = React.useState<AuthTokenListEntry[]>([]);
  const [listBusy, setListBusy] = React.useState(false);
  const [listError, setListError] = React.useState<unknown>(undefined);
  const [issueOpen, setIssueOpen] = React.useState(false);
  const [issueRole, setIssueRole] = React.useState<TokenRole>("client");
  const [issueDeviceId, setIssueDeviceId] = React.useState("operator-ui");
  const [issueScopes, setIssueScopes] = React.useState("");
  const [issueTtlSeconds, setIssueTtlSeconds] = React.useState("600");
  const [issueResult, setIssueResult] = React.useState<unknown>(undefined);
  const [issueError, setIssueError] = React.useState<unknown>(undefined);
  const [revokeTarget, setRevokeTarget] = React.useState<AuthTokenListEntry | null>(null);
  const [revokeResult, setRevokeResult] = React.useState<unknown>(undefined);
  const [revokeError, setRevokeError] = React.useState<unknown>(undefined);

  const issueDeviceIdTrimmed = issueDeviceId.trim();
  const canIssue = canMutate && (issueRole === "admin" || issueDeviceIdTrimmed.length > 0);

  const loadTokens = React.useCallback(async (): Promise<void> => {
    setListBusy(true);
    setListError(undefined);
    try {
      const result = await http.authTokens.list();
      setTokens(result.tokens);
    } catch (error) {
      setListError(error);
    } finally {
      setListBusy(false);
    }
  }, [http]);

  React.useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  const runIssue = async (): Promise<void> => {
    setIssueResult(undefined);
    setIssueError(undefined);
    if (!canMutate) {
      requestEnter();
      throw new Error("Enter Elevated Mode to issue tokens.");
    }

    const ttlRaw = issueTtlSeconds.trim();
    const ttl_seconds = ttlRaw.length > 0 ? Number(ttlRaw) : undefined;
    if (typeof ttl_seconds === "number" && (!Number.isInteger(ttl_seconds) || ttl_seconds <= 0)) {
      throw new Error("TTL must be a positive integer number of seconds.");
    }
    if (issueRole !== "admin" && issueDeviceIdTrimmed.length === 0) {
      throw new Error("Device ID is required for client and node tokens.");
    }

    try {
      const result = await http.authTokens.issue({
        role: issueRole,
        scopes: parseScopesInput(issueScopes),
        ...(issueDeviceIdTrimmed.length > 0 ? { device_id: issueDeviceIdTrimmed } : {}),
        ...(typeof ttl_seconds === "number" ? { ttl_seconds } : {}),
      });
      setIssueResult(result);
      await loadTokens();
    } catch (error) {
      setIssueError(error);
      throw error;
    }
  };

  const runRevoke = async (): Promise<void> => {
    setRevokeResult(undefined);
    setRevokeError(undefined);
    if (!canMutate) {
      requestEnter();
      throw new Error("Enter Elevated Mode to revoke tokens.");
    }
    if (!revokeTarget) {
      throw new Error("Select a token to revoke.");
    }

    try {
      const result = await http.authTokens.revoke({ token_id: revokeTarget.token_id });
      setRevokeResult(result);
      await loadTokens();
    } catch (error) {
      setRevokeError(error);
      throw error;
    }
  };

  return (
    <Card data-testid="admin-http-tokens">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Tenant Tokens</div>
        <div className="text-sm text-fg-muted">
          List tenant tokens, mint new ones, and revoke by token ID.
        </div>
      </CardHeader>
      <CardContent className="grid gap-6">
        <Alert
          variant="info"
          title="Write-once secrets"
          description="Token secrets are shown only in the issue result after minting and are not readable later."
        />

        <TokenListCard
          tokens={tokens}
          busy={listBusy}
          error={listError}
          canMutate={canMutate}
          onRefresh={loadTokens}
          onRevoke={setRevokeTarget}
        />

        <Separator />

        <div className="grid gap-4">
          <div className="text-sm font-medium text-fg">Issue token</div>
          <TokenIssueFields
            role={issueRole}
            setRole={setIssueRole}
            deviceId={issueDeviceId}
            setDeviceId={setIssueDeviceId}
            scopes={issueScopes}
            setScopes={setIssueScopes}
            ttlSeconds={issueTtlSeconds}
            setTtlSeconds={setIssueTtlSeconds}
          />
          <ApiResultCard heading="Issue result" value={issueResult} error={issueError} />
        </div>

        <ApiResultCard heading="Revoke result" value={revokeResult} error={revokeError} />
      </CardContent>
      <CardFooter className="gap-3">
        <Button
          type="button"
          variant="danger"
          data-testid="admin-http-tokens-issue"
          disabled={!canIssue}
          onClick={() => {
            setIssueOpen(true);
          }}
        >
          Issue token
        </Button>
        {!canMutate ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              requestEnter();
            }}
          >
            Enter Elevated Mode
          </Button>
        ) : null}
      </CardFooter>

      <ConfirmDangerDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        title="Issue tenant token"
        description="This creates credentials that can immediately access the tenant gateway APIs."
        confirmLabel="Issue token"
        onConfirm={runIssue}
      />

      <ConfirmDangerDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevokeTarget(null);
          }
        }}
        title="Revoke tenant token"
        description="This invalidates the selected token immediately."
        confirmLabel="Revoke token"
        onConfirm={runRevoke}
      >
        <div className="grid gap-2 text-sm text-fg-muted">
          <div>
            <span className="font-medium text-fg">Token ID:</span>{" "}
            <span className="font-mono text-xs">{revokeTarget?.token_id ?? "(missing)"}</span>
          </div>
          <div>
            <span className="font-medium text-fg">Role:</span> {revokeTarget?.role ?? "(missing)"}
          </div>
        </div>
      </ConfirmDangerDialog>
    </Card>
  );
}
