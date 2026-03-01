import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Input } from "../ui/input.js";
import { JsonTextarea } from "../ui/json-textarea.js";
import { Label } from "../ui/label.js";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";

type ApiActionState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; value: T }
  | { status: "error"; error: unknown };

function useApiAction<T>() {
  const [state, setState] = React.useState<ApiActionState<T>>({ status: "idle" });

  const run = React.useCallback(
    async (
      action: () => Promise<T>,
      options?: { throwOnError?: boolean },
    ): Promise<T | undefined> => {
      setState({ status: "loading" });
      try {
        const value = await action();
        setState({ status: "success", value });
        return value;
      } catch (error) {
        setState({ status: "error", error });
        if (options?.throwOnError) throw error;
        return undefined;
      }
    },
    [],
  );

  const reset = React.useCallback(() => {
    setState({ status: "idle" });
  }, []);

  return {
    state,
    isLoading: state.status === "loading",
    value: state.status === "success" ? state.value : undefined,
    error: state.status === "error" ? state.error : undefined,
    run,
    reset,
  };
}

function optionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function AuditPanel({ core }: { core: OperatorCore }) {
  const auditApi = core.http.audit;

  const [exportPlanId, setExportPlanId] = React.useState("");
  const exportAction = useApiAction<unknown>();

  const [verifyRaw, setVerifyRaw] = React.useState("");
  const [verifyValue, setVerifyValue] = React.useState<unknown | undefined>(undefined);
  const [verifyError, setVerifyError] = React.useState<string | null>(null);
  const verifyAction = useApiAction<unknown>();

  const [forgetEntityType, setForgetEntityType] = React.useState("");
  const [forgetEntityId, setForgetEntityId] = React.useState("");
  const [forgetDecision, setForgetDecision] = React.useState<"delete" | "anonymize" | "retain">(
    "delete",
  );
  const [forgetOpen, setForgetOpen] = React.useState(false);
  const forgetAction = useApiAction<unknown>();

  return (
    <Card data-testid="admin-http-audit-panel">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Audit</div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Tabs defaultValue="export" className="grid gap-3">
          <TabsList aria-label="Audit endpoints">
            <TabsTrigger value="export">Export</TabsTrigger>
            <TabsTrigger value="verify">Verify</TabsTrigger>
            <TabsTrigger value="forget">Forget</TabsTrigger>
          </TabsList>

          <TabsContent value="export" className="grid gap-3">
            <Input
              label="Plan ID"
              placeholder="agent-turn-default-..."
              value={exportPlanId}
              onChange={(event) => {
                setExportPlanId(event.target.value);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                isLoading={exportAction.isLoading}
                disabled={!optionalString(exportPlanId)}
                onClick={() => {
                  void exportAction.run(() => auditApi.exportReceiptBundle(exportPlanId));
                }}
              >
                Export receipt bundle
              </Button>
              <Button
                variant="secondary"
                disabled={exportAction.isLoading}
                onClick={() => {
                  exportAction.reset();
                }}
              >
                Clear
              </Button>
            </div>
            <ApiResultCard
              heading="Export result"
              value={exportAction.value}
              error={exportAction.error}
              jsonViewerProps={{ defaultExpandedDepth: 1, contentClassName: "max-h-[420px]" }}
            />
          </TabsContent>

          <TabsContent value="verify" className="grid gap-3">
            <JsonTextarea
              label="Verify request JSON"
              placeholder='{"events":[{"id":1,"plan_id":"...","step_index":0,"occurred_at":"2026-01-01T00:00:00.000Z","action":"...","prev_hash":null,"event_hash":null}]}'
              rows={6}
              value={verifyRaw}
              onChange={(event) => {
                setVerifyRaw(event.target.value);
              }}
              onJsonChange={(value, errorMessage) => {
                if (errorMessage) {
                  setVerifyValue(undefined);
                  setVerifyError(errorMessage);
                  return;
                }
                setVerifyError(null);
                setVerifyValue(value);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                isLoading={verifyAction.isLoading}
                disabled={verifyError !== null || typeof verifyValue === "undefined"}
                onClick={() => {
                  void verifyAction.run(() => auditApi.verify(verifyValue as never));
                }}
              >
                Verify chain
              </Button>
              <Button
                variant="secondary"
                disabled={verifyAction.isLoading}
                onClick={() => {
                  verifyAction.reset();
                }}
              >
                Clear
              </Button>
            </div>
            <ApiResultCard
              heading="Verify result"
              value={verifyAction.value}
              error={verifyAction.error}
              jsonViewerProps={{ defaultExpandedDepth: 1, contentClassName: "max-h-[420px]" }}
            />
          </TabsContent>

          <TabsContent value="forget" className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Entity type"
                placeholder="user | session | ..."
                value={forgetEntityType}
                onChange={(event) => {
                  setForgetEntityType(event.target.value);
                }}
              />
              <Input
                label="Entity id"
                placeholder="..."
                value={forgetEntityId}
                onChange={(event) => {
                  setForgetEntityId(event.target.value);
                }}
              />
            </div>

            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium leading-none text-fg">Decision</legend>
              <RadioGroup
                value={forgetDecision}
                onValueChange={(value) => {
                  if (value === "delete" || value === "anonymize" || value === "retain") {
                    setForgetDecision(value);
                  }
                }}
                className="flex flex-wrap gap-4"
              >
                {(["delete", "anonymize", "retain"] as const).map((decision) => {
                  const id = `audit-forget-${decision}`;
                  return (
                    <div key={decision} className="flex items-center gap-2">
                      <RadioGroupItem id={id} value={decision} />
                      <Label htmlFor={id} className="text-sm font-normal text-fg">
                        {decision}
                      </Label>
                    </div>
                  );
                })}
              </RadioGroup>
            </fieldset>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                disabled={!optionalString(forgetEntityType) || !optionalString(forgetEntityId)}
                onClick={() => {
                  setForgetOpen(true);
                }}
              >
                Forget…
              </Button>
              <Button
                variant="secondary"
                disabled={forgetAction.isLoading}
                onClick={() => {
                  forgetAction.reset();
                }}
              >
                Clear
              </Button>
            </div>

            <ApiResultCard
              heading="Forget result"
              value={forgetAction.value}
              error={forgetAction.error}
              jsonViewerProps={{ defaultExpandedDepth: 1, contentClassName: "max-h-[420px]" }}
            />

            <ConfirmDangerDialog
              open={forgetOpen}
              onOpenChange={setForgetOpen}
              title="Forget audit receipts?"
              description="This action may delete or anonymize audit receipts and cannot be undone."
              confirmLabel="Forget"
              onConfirm={async () => {
                await forgetAction.run(
                  () =>
                    auditApi.forget({
                      confirm: "FORGET",
                      entity_type: forgetEntityType,
                      entity_id: forgetEntityId,
                      decision: forgetDecision,
                    }),
                  { throwOnError: true },
                );
              }}
              isLoading={forgetAction.isLoading}
            >
              <div className="grid gap-2 text-sm text-fg">
                <div>
                  <span className="text-fg-muted">Entity:</span>{" "}
                  <span className="font-mono">
                    {optionalString(forgetEntityType) ?? "<missing>"}:
                    {optionalString(forgetEntityId) ?? "<missing>"}
                  </span>
                </div>
                <div>
                  <span className="text-fg-muted">Decision:</span>{" "}
                  <span className="font-mono">{forgetDecision}</span>
                </div>
              </div>
            </ConfirmDangerDialog>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function ContextPanel({ core }: { core: OperatorCore }) {
  const contextApi = core.http.context;

  const [getAgentId, setGetAgentId] = React.useState("");
  const getAction = useApiAction<unknown>();

  const [listSessionId, setListSessionId] = React.useState("");
  const [listRunId, setListRunId] = React.useState("");
  const [listLimit, setListLimit] = React.useState("");
  const listAction = useApiAction<unknown>();

  const [detailId, setDetailId] = React.useState("");
  const detailAction = useApiAction<unknown>();

  const resolvedGetAgentId = optionalString(getAgentId);
  const resolvedListSessionId = optionalString(listSessionId);
  const resolvedListRunId = optionalString(listRunId);
  const resolvedDetailId = optionalString(detailId);

  const parsedLimit = (() => {
    const trimmed = listLimit.trim();
    if (!trimmed) return undefined;
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  })();

  const invalidLimit = listLimit.trim() !== "" && parsedLimit === undefined;

  return (
    <Card data-testid="admin-http-context-panel">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Context</div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Tabs defaultValue="get" className="grid gap-3">
          <TabsList aria-label="Context endpoints">
            <TabsTrigger value="get">Get</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="detail">Detail</TabsTrigger>
          </TabsList>

          <TabsContent value="get" className="grid gap-3">
            <Input
              label="Agent id (optional)"
              placeholder="default"
              value={getAgentId}
              onChange={(event) => {
                setGetAgentId(event.target.value);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                isLoading={getAction.isLoading}
                onClick={() => {
                  void getAction.run(() =>
                    contextApi.get(resolvedGetAgentId ? { agent_id: resolvedGetAgentId } : {}),
                  );
                }}
              >
                Fetch
              </Button>
              <Button
                variant="secondary"
                disabled={getAction.isLoading}
                onClick={() => {
                  getAction.reset();
                }}
              >
                Clear
              </Button>
            </div>
            <ApiResultCard
              heading="Get result"
              value={getAction.value}
              error={getAction.error}
              jsonViewerProps={{ defaultExpandedDepth: 1, contentClassName: "max-h-[420px]" }}
            />
          </TabsContent>

          <TabsContent value="list" className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Session id (optional)"
                placeholder="..."
                value={listSessionId}
                onChange={(event) => {
                  setListSessionId(event.target.value);
                }}
              />
              <Input
                label="Run id (optional)"
                placeholder="..."
                value={listRunId}
                onChange={(event) => {
                  setListRunId(event.target.value);
                }}
              />
            </div>
            <Input
              label="Limit (optional)"
              type="number"
              min={1}
              value={listLimit}
              onChange={(event) => {
                setListLimit(event.target.value);
              }}
              helperText={invalidLimit ? "Must be a positive integer" : undefined}
              error={invalidLimit ? "Invalid limit" : undefined}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                isLoading={listAction.isLoading}
                disabled={invalidLimit}
                onClick={() => {
                  void listAction.run(() =>
                    contextApi.list({
                      ...(resolvedListSessionId ? { session_id: resolvedListSessionId } : {}),
                      ...(resolvedListRunId ? { run_id: resolvedListRunId } : {}),
                      ...(typeof parsedLimit === "number" ? { limit: parsedLimit } : {}),
                    }),
                  );
                }}
              >
                Fetch
              </Button>
              <Button
                variant="secondary"
                disabled={listAction.isLoading}
                onClick={() => {
                  listAction.reset();
                }}
              >
                Clear
              </Button>
            </div>
            <ApiResultCard
              heading="List result"
              value={listAction.value}
              error={listAction.error}
              jsonViewerProps={{ defaultExpandedDepth: 1, contentClassName: "max-h-[420px]" }}
            />
          </TabsContent>

          <TabsContent value="detail" className="grid gap-3">
            <Input
              label="Context report id"
              placeholder="uuid"
              value={detailId}
              onChange={(event) => {
                setDetailId(event.target.value);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                isLoading={detailAction.isLoading}
                disabled={!resolvedDetailId}
                onClick={() => {
                  if (!resolvedDetailId) return;
                  void detailAction.run(() => contextApi.detail(resolvedDetailId));
                }}
              >
                Fetch
              </Button>
              <Button
                variant="secondary"
                disabled={detailAction.isLoading}
                onClick={() => {
                  detailAction.reset();
                }}
              >
                Clear
              </Button>
            </div>
            <ApiResultCard
              heading="Detail result"
              value={detailAction.value}
              error={detailAction.error}
              jsonViewerProps={{ defaultExpandedDepth: 1, contentClassName: "max-h-[420px]" }}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function AgentStatusPanel({ core }: { core: OperatorCore }) {
  const agentStatusApi = core.http.agentStatus;
  const [agentId, setAgentId] = React.useState("");
  const action = useApiAction<unknown>();
  const resolvedAgentId = optionalString(agentId);

  return (
    <Card data-testid="admin-http-agent-status-panel">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Agent Status</div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Input
          label="Agent id (optional)"
          placeholder="default"
          value={agentId}
          onChange={(event) => {
            setAgentId(event.target.value);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            isLoading={action.isLoading}
            onClick={() => {
              void action.run(() =>
                agentStatusApi.get(resolvedAgentId ? { agent_id: resolvedAgentId } : {}),
              );
            }}
          >
            Fetch
          </Button>
          <Button
            variant="secondary"
            disabled={action.isLoading}
            onClick={() => {
              action.reset();
            }}
          >
            Clear
          </Button>
        </div>
        <ApiResultCard
          heading="Agent status"
          value={action.value}
          error={action.error}
          jsonViewerProps={{ defaultExpandedDepth: 1, contentClassName: "max-h-[420px]" }}
        />
      </CardContent>
    </Card>
  );
}

type ArtifactBytesUiResult =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | { kind: "redirect"; url: string }
  | { kind: "bytes"; url: string; contentType?: string; byteLength: number };

function ArtifactsPanel({ core }: { core: OperatorCore }) {
  const artifactsApi = core.http.artifacts;

  const [runId, setRunId] = React.useState("");
  const [artifactId, setArtifactId] = React.useState("");

  const metadataAction = useApiAction<unknown>();
  const [bytesResult, setBytesResult] = React.useState<ArtifactBytesUiResult>({ kind: "idle" });

  React.useEffect(() => {
    if (bytesResult.kind !== "bytes") return;
    const url = bytesResult.url;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [bytesResult]);

  const resolvedRunId = optionalString(runId);
  const resolvedArtifactId = optionalString(artifactId);
  const canQuery = Boolean(resolvedRunId && resolvedArtifactId);

  const fetchMetadata = (): void => {
    if (!resolvedRunId || !resolvedArtifactId) return;
    void metadataAction.run(() => artifactsApi.getMetadata(resolvedRunId, resolvedArtifactId));
  };

  const downloadBytes = (): void => {
    if (!resolvedRunId || !resolvedArtifactId) return;
    setBytesResult({ kind: "loading" });
    void artifactsApi
      .getBytes(resolvedRunId, resolvedArtifactId)
      .then((res) => {
        if (res.kind === "redirect") {
          setBytesResult({ kind: "redirect", url: res.url });
          return;
        }
        const contentType = res.contentType ?? "application/octet-stream";
        const blob = new Blob([res.bytes], { type: contentType });
        const url = URL.createObjectURL(blob);
        setBytesResult({
          kind: "bytes",
          url,
          contentType: res.contentType,
          byteLength: res.bytes.byteLength,
        });
      })
      .catch((error) => {
        setBytesResult({ kind: "error", error });
      });
  };

  const clearBytes = (): void => {
    setBytesResult({ kind: "idle" });
  };

  const bytesApiValue = (() => {
    if (bytesResult.kind === "bytes") {
      return {
        kind: bytesResult.kind,
        byteLength: bytesResult.byteLength,
        contentType: bytesResult.contentType,
      };
    }
    if (bytesResult.kind === "redirect") {
      return { kind: bytesResult.kind, url: bytesResult.url };
    }
    return undefined;
  })();

  const bytesApiError = bytesResult.kind === "error" ? bytesResult.error : undefined;

  const downloadLink = (() => {
    if (bytesResult.kind === "redirect") {
      return (
        <a
          className="text-sm text-fg underline"
          href={bytesResult.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          Open artifact
        </a>
      );
    }

    if (bytesResult.kind === "bytes") {
      return (
        <a
          className="text-sm text-fg underline"
          href={bytesResult.url}
          download={resolvedArtifactId}
        >
          Download bytes
        </a>
      );
    }

    return null;
  })();

  return (
    <Card data-testid="admin-http-artifacts-panel">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Artifacts</div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Run id"
            placeholder="uuid"
            value={runId}
            onChange={(event) => {
              setRunId(event.target.value);
            }}
          />
          <Input
            label="Artifact id"
            placeholder="artifact-..."
            value={artifactId}
            onChange={(event) => {
              setArtifactId(event.target.value);
            }}
          />
        </div>

        <Tabs defaultValue="metadata" className="grid gap-3">
          <TabsList aria-label="Artifact endpoints">
            <TabsTrigger value="metadata">Metadata</TabsTrigger>
            <TabsTrigger value="download">Download</TabsTrigger>
          </TabsList>

          <TabsContent value="metadata" className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                isLoading={metadataAction.isLoading}
                disabled={!canQuery}
                onClick={() => {
                  fetchMetadata();
                }}
              >
                Fetch metadata
              </Button>
              <Button
                variant="secondary"
                disabled={metadataAction.isLoading}
                onClick={() => {
                  metadataAction.reset();
                }}
              >
                Clear
              </Button>
            </div>
            <ApiResultCard
              heading="Metadata"
              value={metadataAction.value}
              error={metadataAction.error}
              jsonViewerProps={{ defaultExpandedDepth: 1, contentClassName: "max-h-[420px]" }}
            />
          </TabsContent>

          <TabsContent value="download" className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                data-testid="admin-http-artifacts-download"
                isLoading={bytesResult.kind === "loading"}
                disabled={!canQuery || bytesResult.kind === "loading"}
                onClick={() => {
                  downloadBytes();
                }}
              >
                Fetch bytes
              </Button>
              <Button
                variant="secondary"
                disabled={bytesResult.kind === "loading"}
                onClick={() => {
                  clearBytes();
                }}
              >
                Clear
              </Button>
              {downloadLink}
            </div>
            <ApiResultCard
              heading="Bytes result"
              value={bytesApiValue}
              error={bytesApiError}
              jsonViewerProps={{ defaultExpandedDepth: 2 }}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function HealthPanel() {
  const action = useApiAction<unknown>();

  const fetchHealth = (): void => {
    void action.run(async () => {
      const response = await fetch("/healthz", { credentials: "omit", cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Health check failed (${response.status})`);
      }
      return (await response.json()) as unknown;
    });
  };

  return (
    <Card data-testid="admin-http-health-panel">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Health</div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="admin-http-health-fetch"
            isLoading={action.isLoading}
            onClick={() => {
              fetchHealth();
            }}
          >
            Fetch /healthz
          </Button>
          <Button
            variant="secondary"
            disabled={action.isLoading}
            onClick={() => {
              action.reset();
            }}
          >
            Clear
          </Button>
        </div>
        <ApiResultCard
          data-testid="admin-http-health-result"
          heading="Health result"
          value={action.value}
          error={action.error}
          jsonViewerProps={{ defaultExpandedDepth: 2 }}
        />
      </CardContent>
    </Card>
  );
}

export function AdminHttpPanels({ core }: { core: OperatorCore }) {
  return (
    <div className="grid gap-6">
      <AuditPanel core={core} />
      <ContextPanel core={core} />
      <AgentStatusPanel core={core} />
      <ArtifactsPanel core={core} />
      <HealthPanel />
    </div>
  );
}
