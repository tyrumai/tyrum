import type { OperatorCore } from "@tyrum/operator-core";
import { useState } from "react";
import {
  type AdminHttpClient,
  useAdminHttpClient,
  useAdminMutationAccess,
} from "./admin-http-shared.js";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js";
import { Textarea } from "../ui/textarea.js";

function parseScopesInput(value: string): string[] {
  const scopes = value
    .split(/[\n,]+/g)
    .map((scope) => scope.trim())
    .filter(Boolean);
  return Array.from(new Set(scopes));
}

function useDeviceTokensIssueState() {
  const [result, setResult] = useState<unknown | undefined>(undefined);
  const [error, setError] = useState<unknown | undefined>(undefined);
  const [deviceId, setDeviceId] = useState("operator-ui");
  const [role, setRole] = useState<"client" | "node">("client");
  const [scopes, setScopes] = useState("");
  const [ttlSeconds, setTtlSeconds] = useState("600");
  const [open, setOpen] = useState(false);

  return {
    result,
    setResult,
    error,
    setError,
    deviceId,
    setDeviceId,
    role,
    setRole,
    scopes,
    setScopes,
    ttlSeconds,
    setTtlSeconds,
    open,
    setOpen,
  };
}

function useDeviceTokensRevokeState() {
  const [result, setResult] = useState<unknown | undefined>(undefined);
  const [error, setError] = useState<unknown | undefined>(undefined);
  const [token, setToken] = useState("");
  const [open, setOpen] = useState(false);

  return { result, setResult, error, setError, token, setToken, open, setOpen };
}

function DeviceTokensIssueFields({
  issue,
}: {
  issue: ReturnType<typeof useDeviceTokensIssueState>;
}) {
  return (
    <div className="grid gap-4">
      <div className="text-sm font-medium text-fg">Issue</div>
      <Input
        label="Device ID"
        value={issue.deviceId}
        placeholder="device-123"
        onChange={(event) => {
          issue.setDeviceId(event.currentTarget.value);
        }}
      />

      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium leading-none text-fg">
          Role{" "}
          <span aria-hidden="true" className="text-error">
            *
          </span>
        </legend>
        <RadioGroup
          value={issue.role}
          onValueChange={(value) => {
            if (value === "client" || value === "node") {
              issue.setRole(value);
            }
          }}
          className="grid gap-3"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem id="device-token-role-client" value="client" />
            <Label htmlFor="device-token-role-client">Client</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="device-token-role-node" value="node" />
            <Label htmlFor="device-token-role-node">Node</Label>
          </div>
        </RadioGroup>
      </fieldset>

      <Textarea
        label="Scopes"
        rows={3}
        value={issue.scopes}
        placeholder="operator.read\noperator.write"
        onChange={(event) => {
          issue.setScopes(event.currentTarget.value);
        }}
      />

      <Input
        label="TTL (seconds)"
        type="number"
        inputMode="numeric"
        value={issue.ttlSeconds}
        onChange={(event) => {
          issue.setTtlSeconds(event.currentTarget.value);
        }}
      />
    </div>
  );
}

function DeviceTokensRevokeFields({
  revoke,
}: {
  revoke: ReturnType<typeof useDeviceTokensRevokeState>;
}) {
  return (
    <div className="grid gap-4">
      <div className="text-sm font-medium text-fg">Revoke</div>
      <Input
        label="Token"
        type="password"
        value={revoke.token}
        placeholder="dev_..."
        onChange={(event) => {
          revoke.setToken(event.currentTarget.value);
        }}
      />
    </div>
  );
}

function DeviceTokenIssueDialog({
  http,
  canMutate,
  requestEnter,
  issue,
}: {
  http: AdminHttpClient;
  canMutate: boolean;
  requestEnter: () => void;
  issue: ReturnType<typeof useDeviceTokensIssueState>;
}) {
  return (
    <ConfirmDangerDialog
      open={issue.open}
      onOpenChange={issue.setOpen}
      title="Issue device token"
      description="This creates credentials that can be used to access the gateway."
      confirmLabel="Issue"
      onConfirm={async () => {
        issue.setResult(undefined);
        issue.setError(undefined);
        if (!canMutate) {
          requestEnter();
          throw new Error("Authorize admin access to issue device tokens.");
        }

        const ttlSecondsRaw = issue.ttlSeconds.trim();
        const ttl_seconds = ttlSecondsRaw.length > 0 ? Number(ttlSecondsRaw) : undefined;
        if (
          typeof ttl_seconds === "number" &&
          (!Number.isInteger(ttl_seconds) || ttl_seconds <= 0)
        ) {
          throw new Error("TTL must be a positive integer number of seconds.");
        }

        try {
          const result = await http.deviceTokens.issue({
            device_id: issue.deviceId.trim(),
            role: issue.role,
            scopes: parseScopesInput(issue.scopes),
            ...(typeof ttl_seconds === "number" ? { ttl_seconds } : {}),
          });
          issue.setResult(result);
        } catch (error) {
          issue.setError(error);
          throw error;
        }
      }}
    />
  );
}

function DeviceTokenRevokeDialog({
  http,
  canMutate,
  requestEnter,
  revoke,
}: {
  http: AdminHttpClient;
  canMutate: boolean;
  requestEnter: () => void;
  revoke: ReturnType<typeof useDeviceTokensRevokeState>;
}) {
  return (
    <ConfirmDangerDialog
      open={revoke.open}
      onOpenChange={revoke.setOpen}
      title="Revoke device token"
      description="This invalidates a token immediately."
      confirmLabel="Revoke"
      onConfirm={async () => {
        revoke.setResult(undefined);
        revoke.setError(undefined);
        if (!canMutate) {
          requestEnter();
          throw new Error("Authorize admin access to revoke device tokens.");
        }

        try {
          const result = await http.deviceTokens.revoke({
            token: revoke.token.trim(),
          });
          revoke.setResult(result);
        } catch (error) {
          revoke.setError(error);
          throw error;
        }
      }}
    />
  );
}

export function DeviceTokensCard({ core }: { core: OperatorCore }) {
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const adminHttp = useAdminHttpClient();
  const issue = useDeviceTokensIssueState();
  const revoke = useDeviceTokensRevokeState();

  const canIssue = issue.deviceId.trim().length > 0;
  const canRevoke = revoke.token.trim().length > 0;

  return (
    <Card data-testid="admin-http-device-tokens">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Device Tokens</div>
      </CardHeader>
      <CardContent className="grid gap-6">
        <DeviceTokensIssueFields issue={issue} />
        <DeviceTokensRevokeFields revoke={revoke} />
        <ApiResultCard heading="Issue result" value={issue.result} error={issue.error} />
        <ApiResultCard heading="Revoke result" value={revoke.result} error={revoke.error} />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              data-testid="admin-http-device-tokens-issue"
              disabled={!canIssue}
              onClick={() => {
                issue.setOpen(true);
              }}
            >
              Issue token
            </Button>
            <Button
              type="button"
              variant="danger"
              data-testid="admin-http-device-tokens-revoke"
              disabled={!canRevoke}
              onClick={() => {
                revoke.setOpen(true);
              }}
            >
              Revoke token
            </Button>
          </div>
        </ElevatedModeTooltip>
      </CardFooter>
      {adminHttp ? (
        <>
          <DeviceTokenIssueDialog
            http={adminHttp}
            canMutate={canMutate}
            requestEnter={requestEnter}
            issue={issue}
          />
          <DeviceTokenRevokeDialog
            http={adminHttp}
            canMutate={canMutate}
            requestEnter={requestEnter}
            revoke={revoke}
          />
        </>
      ) : null}
    </Card>
  );
}
