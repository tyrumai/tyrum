import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js";

type SecretProviderKind = "env" | "file" | "keychain";

function normalizeAgentId(agentIdRaw: string): { agent_id?: string } | undefined {
  const agentId = agentIdRaw.trim();
  if (!agentId) return undefined;
  return { agent_id: agentId };
}

export function AdminHttpSecretsPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const api = core.http.secrets;

  const [agentIdRaw, setAgentIdRaw] = React.useState("");

  const [listBusy, setListBusy] = React.useState(false);
  const [listResult, setListResult] = React.useState<unknown>(undefined);
  const [listError, setListError] = React.useState<unknown>(undefined);

  const [storeOpen, setStoreOpen] = React.useState(false);
  const [storeScope, setStoreScope] = React.useState("");
  const [storeProvider, setStoreProvider] = React.useState<SecretProviderKind>("env");
  const [storeValue, setStoreValue] = React.useState("");
  const [storeResult, setStoreResult] = React.useState<unknown>(undefined);
  const [storeError, setStoreError] = React.useState<unknown>(undefined);

  const [rotateOpen, setRotateOpen] = React.useState(false);
  const [rotateHandleId, setRotateHandleId] = React.useState("");
  const [rotateValue, setRotateValue] = React.useState("");
  const [rotateResult, setRotateResult] = React.useState<unknown>(undefined);
  const [rotateError, setRotateError] = React.useState<unknown>(undefined);

  const [revokeOpen, setRevokeOpen] = React.useState(false);
  const [revokeHandleId, setRevokeHandleId] = React.useState("");
  const [revokeResult, setRevokeResult] = React.useState<unknown>(undefined);
  const [revokeError, setRevokeError] = React.useState<unknown>(undefined);

  const agentQuery = normalizeAgentId(agentIdRaw);

  const canStore = storeScope.trim().length > 0;
  const canRotate = rotateHandleId.trim().length > 0 && rotateValue.trim().length > 0;
  const canRevoke = revokeHandleId.trim().length > 0;

  const runList = async (): Promise<void> => {
    if (listBusy) return;
    setListBusy(true);
    setListResult(undefined);
    setListError(undefined);
    try {
      const result = await api.list(agentQuery);
      setListResult(result);
    } catch (error) {
      setListError(error);
    } finally {
      setListBusy(false);
    }
  };

  const runStore = async (): Promise<void> => {
    setStoreResult(undefined);
    setStoreError(undefined);
    const scope = storeScope.trim();
    if (!scope) {
      setStoreError(new Error("scope is required"));
      return;
    }

    const rawValue = storeValue;
    const value = rawValue ? rawValue : undefined;

    try {
      const result = await api.store({ scope, value, provider: storeProvider }, agentQuery);
      setStoreResult(result);
      setStoreValue("");
    } catch (error) {
      setStoreError(error);
      throw error;
    }
  };

  const runRotate = async (): Promise<void> => {
    setRotateResult(undefined);
    setRotateError(undefined);

    const handleId = rotateHandleId.trim();
    if (!handleId) {
      setRotateError(new Error("handle_id is required"));
      return;
    }
    const value = rotateValue.trim();
    if (!value) {
      setRotateError(new Error("value is required"));
      return;
    }

    try {
      const result = await api.rotate(handleId, { value }, agentQuery);
      setRotateResult(result);
      setRotateValue("");
    } catch (error) {
      setRotateError(error);
      throw error;
    }
  };

  const runRevoke = async (): Promise<void> => {
    setRevokeResult(undefined);
    setRevokeError(undefined);

    const handleId = revokeHandleId.trim();
    if (!handleId) {
      setRevokeError(new Error("handle_id is required"));
      return;
    }

    try {
      const result = await api.revoke(handleId, agentQuery);
      setRevokeResult(result);
    } catch (error) {
      setRevokeError(error);
      throw error;
    }
  };

  return (
    <section className="grid gap-3" data-testid="admin-http-secrets">
      <div className="text-sm font-medium text-fg">Secrets</div>

      <Card>
        <CardHeader>
          <div className="text-sm font-medium text-fg">Agent scope (optional)</div>
        </CardHeader>
        <CardContent>
          <Input
            label="Agent ID"
            placeholder="Optional"
            value={agentIdRaw}
            onChange={(event) => {
              setAgentIdRaw(event.target.value);
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="text-sm font-medium text-fg">List</div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Button
            type="button"
            variant="secondary"
            data-testid="secrets-list"
            isLoading={listBusy}
            onClick={() => {
              void runList();
            }}
          >
            List secrets
          </Button>
          <ApiResultCard heading="Secrets" value={listResult} error={listError} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="text-sm font-medium text-fg">Store</div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Input
            label="Scope"
            required
            value={storeScope}
            onChange={(event) => {
              setStoreScope(event.target.value);
            }}
          />

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium leading-none text-fg">Provider</legend>
            <RadioGroup
              value={storeProvider}
              onValueChange={(value) => {
                if (value === "env" || value === "file" || value === "keychain") {
                  setStoreProvider(value);
                }
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

          <Input
            label="Value"
            type="password"
            placeholder="Write-only"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            value={storeValue}
            onChange={(event) => {
              setStoreValue(event.target.value);
            }}
          />

          <ApiResultCard heading="Store result" value={storeResult} error={storeError} />
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            variant="danger"
            data-testid="secrets-store-open"
            disabled={!canStore}
            onClick={() => {
              setStoreOpen(true);
            }}
          >
            Store secret
          </Button>
        </CardFooter>
      </Card>

      <ConfirmDangerDialog
        open={storeOpen}
        onOpenChange={setStoreOpen}
        title="Store secret"
        description="Secret values are write-only and will not be displayed after submission."
        confirmLabel="Store"
        onConfirm={runStore}
      />

      <Card>
        <CardHeader>
          <div className="text-sm font-medium text-fg">Rotate</div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Input
            label="Handle ID"
            required
            value={rotateHandleId}
            onChange={(event) => {
              setRotateHandleId(event.target.value);
            }}
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
            value={rotateValue}
            onChange={(event) => {
              setRotateValue(event.target.value);
            }}
          />
          <ApiResultCard heading="Rotate result" value={rotateResult} error={rotateError} />
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            variant="danger"
            data-testid="secrets-rotate-open"
            disabled={!canRotate}
            onClick={() => {
              setRotateOpen(true);
            }}
          >
            Rotate secret
          </Button>
        </CardFooter>
      </Card>

      <ConfirmDangerDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title="Rotate secret"
        description="Secret values are write-only and will not be displayed after submission."
        confirmLabel="Rotate"
        onConfirm={runRotate}
      />

      <Card>
        <CardHeader>
          <div className="text-sm font-medium text-fg">Revoke</div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Input
            label="Handle ID"
            required
            value={revokeHandleId}
            onChange={(event) => {
              setRevokeHandleId(event.target.value);
            }}
          />
          <ApiResultCard heading="Revoke result" value={revokeResult} error={revokeError} />
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            variant="danger"
            data-testid="secrets-revoke-open"
            disabled={!canRevoke}
            onClick={() => {
              setRevokeOpen(true);
            }}
          >
            Revoke secret
          </Button>
        </CardFooter>
      </Card>

      <ConfirmDangerDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title="Revoke secret"
        description="Revoking a secret cannot be undone."
        confirmLabel="Revoke"
        onConfirm={runRevoke}
      />
    </section>
  );
}
