import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Input } from "../ui/input.js";
import { useAdminHttpClient, useAdminMutationAccess } from "./admin-http-shared.js";

type SecretsApi = OperatorCore["http"]["secrets"];
const MANAGED_PROVIDER_SECRET_PREFIX = "provider-account:";

function normalizeAgentKey(agentKeyRaw: string): { agent_key?: string } | undefined {
  const agentKey = agentKeyRaw.trim();
  if (!agentKey) return undefined;
  return { agent_key: agentKey };
}

export function AdminHttpSecretsPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const [agentKeyRaw, setAgentKeyRaw] = React.useState("");
  const { canMutate, requestEnter } = useAdminMutationAccess(core);

  const api = (useAdminHttpClient() ?? core.http).secrets;
  const agentQuery = normalizeAgentKey(agentKeyRaw);

  return (
    <section className="grid gap-3" data-testid="admin-http-secrets">
      <div className="text-sm font-medium text-fg">Secrets</div>

      <AgentScopeCard agentKeyRaw={agentKeyRaw} onAgentKeyRawChange={setAgentKeyRaw} />
      <SecretsListCard api={api} agentQuery={agentQuery} />
      <SecretsStoreCard
        api={api}
        agentQuery={agentQuery}
        canMutate={canMutate}
        requestEnter={requestEnter}
      />
      <SecretsRotateCard
        api={api}
        agentQuery={agentQuery}
        canMutate={canMutate}
        requestEnter={requestEnter}
      />
      <SecretsRevokeCard
        api={api}
        agentQuery={agentQuery}
        canMutate={canMutate}
        requestEnter={requestEnter}
      />
    </section>
  );
}

function AgentScopeCard({
  agentKeyRaw,
  onAgentKeyRawChange,
}: {
  agentKeyRaw: string;
  onAgentKeyRawChange: (next: string) => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <div className="text-sm font-medium text-fg">Agent scope (optional)</div>
      </CardHeader>
      <CardContent>
        <Input
          label="Agent key"
          placeholder="Optional"
          value={agentKeyRaw}
          onChange={(event) => onAgentKeyRawChange(event.target.value)}
        />
      </CardContent>
    </Card>
  );
}

function SecretsListCard({
  api,
  agentQuery,
}: {
  api: SecretsApi;
  agentQuery: ReturnType<typeof normalizeAgentKey>;
}): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<unknown>(undefined);
  const [error, setError] = React.useState<unknown>(undefined);

  const runList = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setResult(undefined);
    setError(undefined);
    try {
      const next = await api.list(agentQuery);
      if (Array.isArray(next.handles)) {
        setResult({
          ...next,
          handles: next.handles.filter(
            (handle) => !handle.handle_id.startsWith(MANAGED_PROVIDER_SECRET_PREFIX),
          ),
        });
      } else {
        setResult(next);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="text-sm font-medium text-fg">List</div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Button
          type="button"
          variant="secondary"
          data-testid="secrets-list"
          isLoading={busy}
          onClick={() => void runList()}
        >
          List secrets
        </Button>
        <ApiResultCard heading="Secrets" value={result} error={error} />
      </CardContent>
    </Card>
  );
}

function SecretsStoreCard({
  api,
  agentQuery,
  canMutate,
  requestEnter,
}: {
  api: SecretsApi;
  agentQuery: ReturnType<typeof normalizeAgentKey>;
  canMutate: boolean;
  requestEnter: () => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [secretKeyRaw, setSecretKeyRaw] = React.useState("");
  const [valueRaw, setValueRaw] = React.useState("");
  const [result, setResult] = React.useState<unknown>(undefined);
  const [error, setError] = React.useState<unknown>(undefined);

  const canStore = secretKeyRaw.trim().length > 0 && valueRaw.trim().length > 0;

  const runStore = async (): Promise<void> => {
    setResult(undefined);
    setError(undefined);
    if (!canMutate) {
      requestEnter();
      throw new Error("Enter Elevated Mode to store secrets.");
    }

    const secretKey = secretKeyRaw.trim();
    if (!secretKey) return void setError(new Error("secret_key is required"));

    const value = valueRaw.trim();
    if (!value) return void setError(new Error("value is required"));

    try {
      setResult(await api.store({ secret_key: secretKey, value }, agentQuery));
      setValueRaw("");
    } catch (e) {
      setError(e);
      throw e;
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="text-sm font-medium text-fg">Store</div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Input
            label="Secret key"
            required
            value={secretKeyRaw}
            onChange={(event) => setSecretKeyRaw(event.target.value)}
          />

          <Input
            label="Value"
            type="password"
            placeholder="Write-only"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            value={valueRaw}
            onChange={(event) => setValueRaw(event.target.value)}
          />

          <ApiResultCard heading="Store result" value={result} error={error} />
        </CardContent>
        <CardFooter>
          <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
            <Button
              type="button"
              variant="danger"
              data-testid="secrets-store-open"
              disabled={!canStore}
              onClick={() => setOpen(true)}
            >
              Store secret
            </Button>
          </ElevatedModeTooltip>
        </CardFooter>
      </Card>

      <ConfirmDangerDialog
        open={open}
        onOpenChange={setOpen}
        title="Store secret"
        description="Secret values are write-only and will not be displayed after submission."
        confirmLabel="Store"
        onConfirm={runStore}
      />
    </>
  );
}

function SecretsRotateCard({
  api,
  agentQuery,
  canMutate,
  requestEnter,
}: {
  api: SecretsApi;
  agentQuery: ReturnType<typeof normalizeAgentKey>;
  canMutate: boolean;
  requestEnter: () => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [handleIdRaw, setHandleIdRaw] = React.useState("");
  const [valueRaw, setValueRaw] = React.useState("");
  const [result, setResult] = React.useState<unknown>(undefined);
  const [error, setError] = React.useState<unknown>(undefined);

  const canRotate = handleIdRaw.trim().length > 0 && valueRaw.trim().length > 0;

  const runRotate = async (): Promise<void> => {
    setResult(undefined);
    setError(undefined);
    if (!canMutate) {
      requestEnter();
      throw new Error("Enter Elevated Mode to rotate secrets.");
    }

    const handleId = handleIdRaw.trim();
    if (!handleId) return void setError(new Error("handle_id is required"));

    const rawValue = valueRaw;
    if (rawValue.trim().length === 0) return void setError(new Error("value is required"));

    try {
      setResult(await api.rotate(handleId, { value: rawValue }, agentQuery));
      setValueRaw("");
    } catch (e) {
      setError(e);
      throw e;
    }
  };

  return (
    <>
      <Card data-testid="secrets-rotate-card">
        <CardHeader>
          <div className="text-sm font-medium text-fg">Rotate</div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Input
            label="Handle ID"
            required
            value={handleIdRaw}
            onChange={(event) => setHandleIdRaw(event.target.value)}
          />
          <Input
            label="New value"
            type="password"
            required
            placeholder="Write-only"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            value={valueRaw}
            onChange={(event) => setValueRaw(event.target.value)}
          />
          <ApiResultCard heading="Rotate result" value={result} error={error} />
        </CardContent>
        <CardFooter>
          <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
            <Button
              type="button"
              variant="danger"
              data-testid="secrets-rotate-open"
              disabled={!canRotate}
              onClick={() => setOpen(true)}
            >
              Rotate secret
            </Button>
          </ElevatedModeTooltip>
        </CardFooter>
      </Card>

      <ConfirmDangerDialog
        open={open}
        onOpenChange={setOpen}
        title="Rotate secret"
        description="Secret values are write-only and will not be displayed after submission."
        confirmLabel="Rotate"
        onConfirm={runRotate}
      />
    </>
  );
}

function SecretsRevokeCard({
  api,
  agentQuery,
  canMutate,
  requestEnter,
}: {
  api: SecretsApi;
  agentQuery: ReturnType<typeof normalizeAgentKey>;
  canMutate: boolean;
  requestEnter: () => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [handleIdRaw, setHandleIdRaw] = React.useState("");
  const [result, setResult] = React.useState<unknown>(undefined);
  const [error, setError] = React.useState<unknown>(undefined);

  const canRevoke = handleIdRaw.trim().length > 0;

  const runRevoke = async (): Promise<void> => {
    setResult(undefined);
    setError(undefined);
    if (!canMutate) {
      requestEnter();
      throw new Error("Enter Elevated Mode to revoke secrets.");
    }

    const handleId = handleIdRaw.trim();
    if (!handleId) return void setError(new Error("handle_id is required"));

    try {
      setResult(await api.revoke(handleId, agentQuery));
    } catch (e) {
      setError(e);
      throw e;
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="text-sm font-medium text-fg">Revoke</div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Input
            label="Handle ID"
            required
            value={handleIdRaw}
            onChange={(event) => setHandleIdRaw(event.target.value)}
          />
          <ApiResultCard heading="Revoke result" value={result} error={error} />
        </CardContent>
        <CardFooter>
          <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
            <Button
              type="button"
              variant="danger"
              data-testid="secrets-revoke-open"
              disabled={!canRevoke}
              onClick={() => setOpen(true)}
            >
              Revoke secret
            </Button>
          </ElevatedModeTooltip>
        </CardFooter>
      </Card>

      <ConfirmDangerDialog
        open={open}
        onOpenChange={setOpen}
        title="Revoke secret"
        description="Revoking a secret cannot be undone."
        confirmLabel="Revoke"
        onConfirm={runRevoke}
      />
    </>
  );
}
