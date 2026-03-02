import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js";
import { useAdminMutationAccess } from "./admin-http-shared.js";

type SecretProviderKind = "env" | "file" | "keychain";
type SecretsApi = OperatorCore["http"]["secrets"];

function normalizeAgentId(agentIdRaw: string): { agent_id?: string } | undefined {
  const agentId = agentIdRaw.trim();
  if (!agentId) return undefined;
  return { agent_id: agentId };
}

export function AdminHttpSecretsPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const [agentIdRaw, setAgentIdRaw] = React.useState("");
  const { canMutate, requestEnter } = useAdminMutationAccess(core);

  const api = core.http.secrets;
  const agentQuery = normalizeAgentId(agentIdRaw);

  return (
    <section className="grid gap-3" data-testid="admin-http-secrets">
      <div className="text-sm font-medium text-fg">Secrets</div>

      <AgentScopeCard agentIdRaw={agentIdRaw} onAgentIdRawChange={setAgentIdRaw} />
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
  agentIdRaw,
  onAgentIdRawChange,
}: {
  agentIdRaw: string;
  onAgentIdRawChange: (next: string) => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <div className="text-sm font-medium text-fg">Agent scope (optional)</div>
      </CardHeader>
      <CardContent>
        <Input
          label="Agent ID"
          placeholder="Optional"
          value={agentIdRaw}
          onChange={(event) => onAgentIdRawChange(event.target.value)}
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
  agentQuery: ReturnType<typeof normalizeAgentId>;
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
      setResult(await api.list(agentQuery));
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
  agentQuery: ReturnType<typeof normalizeAgentId>;
  canMutate: boolean;
  requestEnter: () => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [scopeRaw, setScopeRaw] = React.useState("");
  const [provider, setProvider] = React.useState<SecretProviderKind>("env");
  const [valueRaw, setValueRaw] = React.useState("");
  const [result, setResult] = React.useState<unknown>(undefined);
  const [error, setError] = React.useState<unknown>(undefined);

  const canStore = scopeRaw.trim().length > 0;

  const runStore = async (): Promise<void> => {
    setResult(undefined);
    setError(undefined);
    if (!canMutate) {
      requestEnter();
      throw new Error("Enter Admin Mode to store secrets.");
    }

    const scope = scopeRaw.trim();
    if (!scope) return void setError(new Error("scope is required"));

    const rawValue = valueRaw;
    const value = rawValue ? rawValue : undefined;

    try {
      setResult(await api.store({ scope, value, provider }, agentQuery));
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
            label="Scope"
            required
            value={scopeRaw}
            onChange={(event) => setScopeRaw(event.target.value)}
          />

          <SecretProviderFieldset provider={provider} onProviderChange={setProvider} />

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
          <Button
            type="button"
            variant="danger"
            data-testid="secrets-store-open"
            disabled={!canMutate || !canStore}
            onClick={() => setOpen(true)}
          >
            Store secret
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
              Enter Admin Mode
            </Button>
          ) : null}
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

function SecretProviderFieldset({
  provider,
  onProviderChange,
}: {
  provider: SecretProviderKind;
  onProviderChange: (next: SecretProviderKind) => void;
}): React.ReactElement {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium leading-none text-fg">Provider</legend>
      <RadioGroup
        value={provider}
        onValueChange={(value) => {
          if (value === "env" || value === "file" || value === "keychain") onProviderChange(value);
        }}
        className="grid gap-2"
      >
        {(["env", "file", "keychain"] as const).map((kind) => {
          const id = `secret-provider-${kind}`;
          return (
            <div key={kind} className="flex items-center gap-2">
              <RadioGroupItem id={id} value={kind} />
              <Label htmlFor={id} className="text-sm font-normal text-fg">
                {kind}
              </Label>
            </div>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}

function SecretsRotateCard({
  api,
  agentQuery,
  canMutate,
  requestEnter,
}: {
  api: SecretsApi;
  agentQuery: ReturnType<typeof normalizeAgentId>;
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
      throw new Error("Enter Admin Mode to rotate secrets.");
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
          <Button
            type="button"
            variant="danger"
            data-testid="secrets-rotate-open"
            disabled={!canMutate || !canRotate}
            onClick={() => setOpen(true)}
          >
            Rotate secret
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
              Enter Admin Mode
            </Button>
          ) : null}
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
  agentQuery: ReturnType<typeof normalizeAgentId>;
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
      throw new Error("Enter Admin Mode to revoke secrets.");
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
          <Button
            type="button"
            variant="danger"
            data-testid="secrets-revoke-open"
            disabled={!canMutate || !canRevoke}
            onClick={() => setOpen(true)}
          >
            Revoke secret
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
              Enter Admin Mode
            </Button>
          ) : null}
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
