import { createTyrumHttpClient } from "@tyrum/client";
import { useMemo, useState } from "react";
import { useOperatorStore } from "../../use-operator-store.js";
import { resolveTyrumHttpFetch } from "../../utils/tyrum-http-fetch.js";
import { useAdminModeUiContext } from "../admin-mode/admin-mode-provider.js";
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

function useAdminHttpClient() {
  const { core, mode } = useAdminModeUiContext();
  const adminMode = useOperatorStore(core.adminModeStore);

  return useMemo(() => {
    if (adminMode.status !== "active" || !adminMode.elevatedToken) return null;

    return createTyrumHttpClient({
      baseUrl: core.httpBaseUrl,
      auth: { type: "bearer", token: adminMode.elevatedToken },
      fetch: resolveTyrumHttpFetch(mode),
    });
  }, [adminMode.elevatedToken, adminMode.status, core.httpBaseUrl, mode]);
}

function DeviceTokensCard() {
  const http = useAdminHttpClient();
  const [issueResult, setIssueResult] = useState<unknown | undefined>(undefined);
  const [issueError, setIssueError] = useState<unknown | undefined>(undefined);
  const [issueDeviceId, setIssueDeviceId] = useState("operator-ui");
  const [issueRole, setIssueRole] = useState<"client" | "node">("client");
  const [issueScopes, setIssueScopes] = useState("");
  const [issueTtlSeconds, setIssueTtlSeconds] = useState("600");
  const [issueOpen, setIssueOpen] = useState(false);

  const [revokeResult, setRevokeResult] = useState<unknown | undefined>(undefined);
  const [revokeError, setRevokeError] = useState<unknown | undefined>(undefined);
  const [revokeToken, setRevokeToken] = useState("");
  const [revokeOpen, setRevokeOpen] = useState(false);

  return (
    <Card data-testid="admin-http-device-tokens">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Device Tokens</div>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-4">
          <div className="text-sm font-medium text-fg">Issue</div>
          <Input
            label="Device ID"
            value={issueDeviceId}
            placeholder="device-123"
            onChange={(event) => {
              setIssueDeviceId(event.currentTarget.value);
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
              value={issueRole}
              onValueChange={(value) => {
                if (value === "client" || value === "node") {
                  setIssueRole(value);
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
            value={issueScopes}
            placeholder="operator.read\noperator.write"
            onChange={(event) => {
              setIssueScopes(event.currentTarget.value);
            }}
          />

          <Input
            label="TTL (seconds)"
            type="number"
            inputMode="numeric"
            value={issueTtlSeconds}
            onChange={(event) => {
              setIssueTtlSeconds(event.currentTarget.value);
            }}
          />
        </div>

        <div className="grid gap-4">
          <div className="text-sm font-medium text-fg">Revoke</div>
          <Input
            label="Token"
            type="password"
            value={revokeToken}
            placeholder="dev_..."
            onChange={(event) => {
              setRevokeToken(event.currentTarget.value);
            }}
          />
        </div>

        <ApiResultCard heading="Issue result" value={issueResult} error={issueError} />
        <ApiResultCard heading="Revoke result" value={revokeResult} error={revokeError} />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="danger"
          data-testid="admin-http-device-tokens-issue"
          onClick={() => {
            setIssueOpen(true);
          }}
        >
          Issue token
        </Button>
        <Button
          type="button"
          variant="danger"
          data-testid="admin-http-device-tokens-revoke"
          onClick={() => {
            setRevokeOpen(true);
          }}
        >
          Revoke token
        </Button>
      </CardFooter>

      <ConfirmDangerDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        title="Issue device token"
        description="This creates credentials that can be used to access the gateway."
        confirmLabel="Issue"
        onConfirm={async () => {
          setIssueResult(undefined);
          setIssueError(undefined);
          if (!http) throw new Error("Admin Mode is required");

          const ttlSecondsRaw = issueTtlSeconds.trim();
          const ttl_seconds = ttlSecondsRaw ? Number.parseInt(ttlSecondsRaw, 10) : undefined;

          try {
            const result = await http.deviceTokens.issue({
              device_id: issueDeviceId.trim(),
              role: issueRole,
              scopes: parseScopesInput(issueScopes),
              ...(typeof ttl_seconds === "number" && Number.isFinite(ttl_seconds)
                ? { ttl_seconds }
                : {}),
            });
            setIssueResult(result);
          } catch (error) {
            setIssueError(error);
            throw error;
          }
        }}
      />

      <ConfirmDangerDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title="Revoke device token"
        description="This invalidates a token immediately."
        confirmLabel="Revoke"
        onConfirm={async () => {
          setRevokeResult(undefined);
          setRevokeError(undefined);
          if (!http) throw new Error("Admin Mode is required");

          try {
            const result = await http.deviceTokens.revoke({
              token: revokeToken.trim(),
            });
            setRevokeResult(result);
          } catch (error) {
            setRevokeError(error);
            throw error;
          }
        }}
      />
    </Card>
  );
}

function PluginsCard() {
  const http = useAdminHttpClient();
  const [busy, setBusy] = useState<"list" | "get" | null>(null);
  const [pluginId, setPluginId] = useState("");
  const [listResult, setListResult] = useState<unknown | undefined>(undefined);
  const [listError, setListError] = useState<unknown | undefined>(undefined);
  const [getResult, setGetResult] = useState<unknown | undefined>(undefined);
  const [getError, setGetError] = useState<unknown | undefined>(undefined);

  return (
    <Card data-testid="admin-http-plugins">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Plugins</div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <Button
            type="button"
            isLoading={busy === "list"}
            onClick={() => {
              if (busy) return;
              if (!http) return;
              setBusy("list");
              setListError(undefined);
              setListResult(undefined);
              void http.plugins
                .list()
                .then((result) => {
                  setListResult(result);
                })
                .catch((error) => {
                  setListError(error);
                })
                .finally(() => {
                  setBusy(null);
                });
            }}
          >
            List
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1">
            <Input
              label="Plugin ID"
              value={pluginId}
              placeholder="echo"
              onChange={(event) => {
                setPluginId(event.currentTarget.value);
              }}
            />
          </div>
          <Button
            type="button"
            isLoading={busy === "get"}
            onClick={() => {
              if (busy) return;
              if (!http) return;
              setBusy("get");
              setGetError(undefined);
              setGetResult(undefined);
              void http.plugins
                .get(pluginId.trim())
                .then((result) => {
                  setGetResult(result);
                })
                .catch((error) => {
                  setGetError(error);
                })
                .finally(() => {
                  setBusy(null);
                });
            }}
          >
            Get
          </Button>
        </div>

        <ApiResultCard
          heading="List result"
          value={listResult}
          error={listError}
          jsonViewerProps={{ withDownloadButton: true, downloadFileName: "plugins.json" }}
        />
        <ApiResultCard
          heading="Get result"
          value={getResult}
          error={getError}
          jsonViewerProps={{
            withDownloadButton: true,
            downloadFileName: pluginId.trim() ? `${pluginId.trim()}.json` : "plugin.json",
          }}
        />
      </CardContent>
    </Card>
  );
}

function ContractsCard() {
  const http = useAdminHttpClient();
  const [busy, setBusy] = useState<"catalog" | "schema" | null>(null);
  const [schemaFile, setSchemaFile] = useState("");
  const [catalogResult, setCatalogResult] = useState<unknown | undefined>(undefined);
  const [catalogError, setCatalogError] = useState<unknown | undefined>(undefined);
  const [schemaResult, setSchemaResult] = useState<unknown | undefined>(undefined);
  const [schemaError, setSchemaError] = useState<unknown | undefined>(undefined);

  return (
    <Card data-testid="admin-http-contracts">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Contracts</div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Button
          type="button"
          isLoading={busy === "catalog"}
          onClick={() => {
            if (busy) return;
            if (!http) return;
            setBusy("catalog");
            setCatalogError(undefined);
            setCatalogResult(undefined);
            void http.contracts
              .getCatalog()
              .then((result) => {
                setCatalogResult(result);
              })
              .catch((error) => {
                setCatalogError(error);
              })
              .finally(() => {
                setBusy(null);
              });
          }}
        >
          Get catalog
        </Button>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1">
            <Input
              label="Schema file"
              value={schemaFile}
              placeholder="some-contract.json"
              onChange={(event) => {
                setSchemaFile(event.currentTarget.value);
              }}
            />
          </div>
          <Button
            type="button"
            isLoading={busy === "schema"}
            onClick={() => {
              if (busy) return;
              if (!http) return;
              setBusy("schema");
              setSchemaError(undefined);
              setSchemaResult(undefined);
              void http.contracts
                .getSchema(schemaFile.trim())
                .then((result) => {
                  setSchemaResult(result);
                })
                .catch((error) => {
                  setSchemaError(error);
                })
                .finally(() => {
                  setBusy(null);
                });
            }}
          >
            Get schema
          </Button>
        </div>

        <ApiResultCard
          heading="Catalog"
          value={catalogResult}
          error={catalogError}
          jsonViewerProps={{ withDownloadButton: true, downloadFileName: "catalog.json" }}
        />
        <ApiResultCard
          heading="Schema"
          value={schemaResult}
          error={schemaError}
          jsonViewerProps={{
            withDownloadButton: true,
            downloadFileName: schemaFile.trim() ? schemaFile.trim() : "schema.json",
          }}
        />
      </CardContent>
    </Card>
  );
}

export function AdminHttpPanels() {
  return (
    <div className="grid gap-4">
      <DeviceTokensCard />
      <PluginsCard />
      <ContractsCard />
    </div>
  );
}
