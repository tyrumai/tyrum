import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { AdminModeGate } from "../../admin-mode.js";
import { type ApiCallState, useApiCallState } from "../../hooks/use-api-call-state.js";
import { parseJsonInput } from "../../utils/parse-json-input.js";
import { AdminWsPanels } from "../admin/admin-ws-panels.js";
import { AdminWorkBoardWsHub } from "../admin-workboard/admin-workboard-ws-hub.js";
import { JsonWsPanel } from "../admin-ws/json-ws-panel.js";
import { SubagentsPanels } from "../admin-ws/subagents-panels.js";
import { AdminHttpPanels as AdminHubHttpPanels } from "../admin-http/admin-http-panels.js";
import { PageHeader } from "../layout/page-header.js";
import { AdminHttpPanels } from "./admin-http-panels.js";
import { AdminHttpPolicyAuthPanels } from "./admin-http-policy-auth-panels.js";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Input } from "../ui/input.js";
import { JsonTextarea } from "../ui/json-textarea.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { AdminHttpRoutingConfigPanel } from "./admin-http-routing-config.js";
import { AdminHttpSecretsPanel } from "./admin-http-secrets.js";

export interface AdminPageProps {
  core: OperatorCore;
  onNavigate?: (id: string) => void;
}

const QUICK_LINKS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "memory", label: "Memory" },
  { id: "approvals", label: "Approvals" },
  { id: "runs", label: "Runs" },
  { id: "pairing", label: "Pairing" },
  { id: "settings", label: "Settings" },
] as const;

type UsageGetQuery = Parameters<OperatorCore["http"]["usage"]["get"]>[0];
type UsageGetQueryValue = Exclude<UsageGetQuery, undefined>;

type PairingsApproveInput = Parameters<OperatorCore["http"]["pairings"]["approve"]>[1];
type PairingsDenyInput = Parameters<OperatorCore["http"]["pairings"]["deny"]>[1];
type PairingsDenyBody = Exclude<PairingsDenyInput, undefined>;
type PairingsRevokeInput = Parameters<OperatorCore["http"]["pairings"]["revoke"]>[1];
type PairingsRevokeBody = Exclude<PairingsRevokeInput, undefined>;

type SessionSendPayload = Parameters<OperatorCore["ws"]["sessionSend"]>[0];
type WorkflowRunPayload = Parameters<OperatorCore["ws"]["workflowRun"]>[0];
type WorkflowResumePayload = Parameters<OperatorCore["ws"]["workflowResume"]>[0];
type WorkflowCancelPayload = Parameters<OperatorCore["ws"]["workflowCancel"]>[0];

function ApiResultSection({ state, heading }: { state: ApiCallState; heading: string }) {
  const value = state.status === "success" ? state.value : undefined;
  const error = state.status === "error" ? state.error : undefined;
  return <ApiResultCard heading={heading} value={value} error={error} />;
}

function ObservabilityPanels({ core }: { core: OperatorCore }): React.ReactElement {
  const status = useApiCallState();
  const usage = useApiCallState();
  const presence = useApiCallState();
  const pairingsList = useApiCallState();
  const pairingsMutate = useApiCallState();

  const [usageQueryRaw, setUsageQueryRaw] = React.useState("");
  const usageQuery = React.useMemo(() => parseJsonInput(usageQueryRaw), [usageQueryRaw]);

  const [pairingIdRaw, setPairingIdRaw] = React.useState("");
  const pairingId = (() => {
    const trimmed = pairingIdRaw.trim();
    if (!trimmed) return null;
    const value = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value;
  })();

  const [pairingBodyRaw, setPairingBodyRaw] = React.useState("");
  const pairingBody = React.useMemo(() => parseJsonInput(pairingBodyRaw), [pairingBodyRaw]);

  const [pairingsAction, setPairingsAction] = React.useState<null | "approve" | "deny" | "revoke">(
    null,
  );

  const closePairingsDialog = (): void => {
    setPairingsAction(null);
  };

  const submitPairingsAction = async (): Promise<void> => {
    if (!pairingsAction) return;
    if (pairingId === null) throw new Error("Pairing id is required");

    if (pairingsAction === "approve") {
      if (pairingBody.errorMessage) throw new Error(`Invalid JSON: ${pairingBody.errorMessage}`);
      if (typeof pairingBody.value === "undefined") throw new Error("Approve body is required");
      await pairingsMutate.runAndThrow(() =>
        core.http.pairings.approve(pairingId, pairingBody.value as PairingsApproveInput),
      );
      return;
    }

    if (pairingBody.errorMessage) throw new Error(`Invalid JSON: ${pairingBody.errorMessage}`);
    const bodyValue = pairingBody.value;
    const denyBody: PairingsDenyInput =
      typeof bodyValue === "undefined" ? undefined : (bodyValue as PairingsDenyBody);
    const revokeBody: PairingsRevokeInput =
      typeof bodyValue === "undefined" ? undefined : (bodyValue as PairingsRevokeBody);

    if (pairingsAction === "deny") {
      await pairingsMutate.runAndThrow(() => core.http.pairings.deny(pairingId, denyBody));
      return;
    }

    await pairingsMutate.runAndThrow(() => core.http.pairings.revoke(pairingId, revokeBody));
  };

  return (
    <div className="grid gap-6">
      <section className="grid gap-4" aria-label="HTTP status, usage, and presence">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-fg">status.get()</div>
            <Button
              data-testid="admin-http-status-get"
              size="sm"
              variant="secondary"
              isLoading={status.state.status === "loading"}
              onClick={() => {
                void status.run(() => core.http.status.get());
              }}
            >
              Fetch
            </Button>
          </div>
          <ApiResultSection state={status.state} heading="Status" />
        </div>

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-fg">usage.get()</div>
            <Button
              data-testid="admin-http-usage-get"
              size="sm"
              variant="secondary"
              isLoading={usage.state.status === "loading"}
              disabled={usageQuery.errorMessage !== null}
              onClick={() => {
                const query: UsageGetQuery =
                  typeof usageQuery.value === "undefined"
                    ? undefined
                    : (usageQuery.value as UsageGetQueryValue);
                void usage.run(() => core.http.usage.get(query));
              }}
            >
              Fetch
            </Button>
          </div>
          <JsonTextarea
            value={usageQueryRaw}
            rows={4}
            placeholder='Optional query JSON. Example: {"run_id":"..."}'
            helperText="Optional. Leave blank for deployment usage."
            onChange={(event) => {
              setUsageQueryRaw(event.currentTarget.value);
            }}
          />
          <ApiResultSection state={usage.state} heading="Usage" />
        </div>

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-fg">presence.list()</div>
            <Button
              data-testid="admin-http-presence-list"
              size="sm"
              variant="secondary"
              isLoading={presence.state.status === "loading"}
              onClick={() => {
                void presence.run(() => core.http.presence.list());
              }}
            >
              Fetch
            </Button>
          </div>
          <ApiResultSection state={presence.state} heading="Presence" />
        </div>
      </section>

      <section className="grid gap-4" aria-label="HTTP pairing administration">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-fg">pairings.list()</div>
            <Button
              data-testid="admin-http-pairings-list"
              size="sm"
              variant="secondary"
              isLoading={pairingsList.state.status === "loading"}
              onClick={() => {
                void pairingsList.run(() => core.http.pairings.list());
              }}
            >
              Fetch
            </Button>
          </div>
          <ApiResultSection state={pairingsList.state} heading="Pairings" />
        </div>

        <Card>
          <CardHeader>
            <div className="text-sm font-medium text-fg">pairings.approve()/deny()/revoke()</div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Input
              data-testid="admin-http-pairings-mutate-id"
              label="Pairing id"
              value={pairingIdRaw}
              onChange={(event) => {
                setPairingIdRaw(event.currentTarget.value);
              }}
              placeholder="123"
              inputMode="numeric"
              autoComplete="off"
            />

            <JsonTextarea
              data-testid="admin-http-pairings-mutate-body"
              label="Request body JSON"
              value={pairingBodyRaw}
              rows={6}
              placeholder='For approve: {"trust_level":"local","capability_allowlist":[],"reason":"..."}'
              helperText="Approve requires trust_level and capability_allowlist. Deny/revoke accept optional reason."
              onChange={(event) => {
                setPairingBodyRaw(event.currentTarget.value);
              }}
            />

            <div className="flex flex-wrap gap-2">
              <Button
                data-testid="admin-http-pairings-approve"
                size="sm"
                variant="primary"
                disabled={
                  pairingId === null ||
                  pairingBody.errorMessage !== null ||
                  pairingBody.value === undefined
                }
                onClick={() => {
                  setPairingsAction("approve");
                }}
              >
                Approve (confirm)
              </Button>
              <Button
                data-testid="admin-http-pairings-deny"
                size="sm"
                variant="secondary"
                disabled={pairingId === null || pairingBody.errorMessage !== null}
                onClick={() => {
                  setPairingsAction("deny");
                }}
              >
                Deny (confirm)
              </Button>
              <Button
                data-testid="admin-http-pairings-revoke"
                size="sm"
                variant="danger"
                disabled={pairingId === null || pairingBody.errorMessage !== null}
                onClick={() => {
                  setPairingsAction("revoke");
                }}
              >
                Revoke (confirm)
              </Button>
            </div>

            <ApiResultSection state={pairingsMutate.state} heading="Mutation result" />
          </CardContent>
        </Card>

        <ConfirmDangerDialog
          open={pairingsAction !== null}
          onOpenChange={(open) => {
            if (open) return;
            closePairingsDialog();
          }}
          title={`Confirm ${pairingsAction ?? "pairing"} action`}
          description={`This will ${pairingsAction ?? "mutate"} pairing ${
            pairingId === null ? "(missing id)" : `#${String(pairingId)}`
          }.`}
          confirmLabel="Run mutation"
          onConfirm={submitPairingsAction}
          isLoading={pairingsMutate.state.status === "loading"}
        />
      </section>
    </div>
  );
}

function ModelsPanels({ core }: { core: OperatorCore }): React.ReactElement {
  const status = useApiCallState();
  const refresh = useApiCallState();
  const listProviders = useApiCallState();
  const getProvider = useApiCallState();
  const listProviderModels = useApiCallState();

  const [providerId, setProviderId] = React.useState("");
  const trimmedProviderId = providerId.trim();

  const [refreshOpen, setRefreshOpen] = React.useState(false);

  return (
    <div className="grid gap-6">
      <section className="grid gap-4" aria-label="HTTP models status">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-fg">models.status()</div>
            <Button
              data-testid="admin-http-models-status"
              size="sm"
              variant="secondary"
              isLoading={status.state.status === "loading"}
              onClick={() => {
                void status.run(() => core.http.models.status());
              }}
            >
              Fetch
            </Button>
          </div>
          <ApiResultSection state={status.state} heading="Models status" />
        </div>

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-fg">models.refresh() (dangerous)</div>
            <Button
              data-testid="admin-http-models-refresh"
              size="sm"
              variant="danger"
              onClick={() => {
                setRefreshOpen(true);
              }}
            >
              Refresh (confirm)
            </Button>
          </div>
          <ApiResultSection state={refresh.state} heading="Refresh result" />
        </div>

        <ConfirmDangerDialog
          open={refreshOpen}
          onOpenChange={setRefreshOpen}
          title="Refresh model catalog"
          description="This forces providers to refresh model availability. Admin-only and potentially disruptive."
          confirmLabel="Refresh models"
          onConfirm={async () => {
            await refresh.runAndThrow(() => core.http.models.refresh());
          }}
          isLoading={refresh.state.status === "loading"}
        />
      </section>

      <section className="grid gap-4" aria-label="HTTP models providers">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-fg">models.listProviders()</div>
            <Button
              data-testid="admin-http-models-providers-list"
              size="sm"
              variant="secondary"
              isLoading={listProviders.state.status === "loading"}
              onClick={() => {
                void listProviders.run(() => core.http.models.listProviders());
              }}
            >
              Fetch
            </Button>
          </div>
          <ApiResultSection state={listProviders.state} heading="Providers" />
        </div>

        <Card>
          <CardHeader>
            <div className="text-sm font-medium text-fg">Provider lookup</div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Input
              data-testid="admin-http-models-provider-id"
              label="Provider id"
              value={providerId}
              onChange={(event) => {
                setProviderId(event.currentTarget.value);
              }}
              placeholder="openai"
              autoComplete="off"
            />

            <div className="flex flex-wrap gap-2">
              <Button
                data-testid="admin-http-models-provider-get"
                size="sm"
                variant="secondary"
                disabled={!trimmedProviderId}
                isLoading={getProvider.state.status === "loading"}
                onClick={() => {
                  void getProvider.run(() => core.http.models.getProvider(trimmedProviderId));
                }}
              >
                Get provider
              </Button>
              <Button
                data-testid="admin-http-models-provider-models-list"
                size="sm"
                variant="secondary"
                disabled={!trimmedProviderId}
                isLoading={listProviderModels.state.status === "loading"}
                onClick={() => {
                  void listProviderModels.run(() =>
                    core.http.models.listProviderModels(trimmedProviderId),
                  );
                }}
              >
                List models
              </Button>
            </div>

            <ApiResultSection state={getProvider.state} heading="Provider" />
            <ApiResultSection state={listProviderModels.state} heading="Provider models" />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
export function AdminPage({ core, onNavigate }: AdminPageProps) {
  return (
    <div className="grid gap-6" data-testid="admin-page">
      <PageHeader title="Admin" />

      <section className="grid gap-2" aria-label="Operator shortcuts">
        <div className="text-sm font-medium text-fg">Shortcuts</div>
        <div className="flex flex-wrap gap-2">
          {QUICK_LINKS.map((link) => (
            <Button
              key={link.id}
              type="button"
              variant="secondary"
              onClick={() => {
                onNavigate?.(link.id);
              }}
            >
              {link.label}
            </Button>
          ))}
        </div>
      </section>

      <Tabs defaultValue="http" className="grid gap-3">
        <TabsList aria-label="Admin panel type">
          <TabsTrigger value="http" data-testid="admin-tab-http">
            HTTP
          </TabsTrigger>
          <TabsTrigger value="ws" data-testid="admin-tab-ws">
            WebSocket
          </TabsTrigger>
        </TabsList>

        <AdminModeGate>
          <TabsContent value="http">
            <Tabs defaultValue="observability" className="grid gap-3">
              <TabsList aria-label="Admin HTTP API sections">
                <TabsTrigger value="observability" data-testid="admin-http-tab-observability">
                  Observability
                </TabsTrigger>
                <TabsTrigger value="hub" data-testid="admin-http-tab-hub">
                  Hub
                </TabsTrigger>
                <TabsTrigger value="models" data-testid="admin-http-tab-models">
                  Models
                </TabsTrigger>
                <TabsTrigger value="gateway" data-testid="admin-http-tab-gateway">
                  Gateway
                </TabsTrigger>
                <TabsTrigger value="policy-auth" data-testid="admin-http-tab-policy-auth">
                  Policy + Auth
                </TabsTrigger>
                <TabsTrigger value="routing-config" data-testid="admin-http-tab-routing-config">
                  Routing config
                </TabsTrigger>
                <TabsTrigger value="secrets" data-testid="admin-http-tab-secrets">
                  Secrets
                </TabsTrigger>
              </TabsList>

              <TabsContent value="observability">
                <ObservabilityPanels core={core} />
              </TabsContent>

              <TabsContent value="hub">
                <AdminHubHttpPanels core={core} />
              </TabsContent>

              <TabsContent value="models">
                <ModelsPanels core={core} />
              </TabsContent>

              <TabsContent value="gateway">
                <AdminHttpPanels />
              </TabsContent>

              <TabsContent value="policy-auth">
                <AdminHttpPolicyAuthPanels />
              </TabsContent>

              <TabsContent value="routing-config">
                <AdminHttpRoutingConfigPanel core={core} />
              </TabsContent>

              <TabsContent value="secrets">
                <AdminHttpSecretsPanel core={core} />
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="ws">
            <Tabs defaultValue="subagents" className="grid gap-3">
              <TabsList aria-label="Admin WebSocket API sections">
                <TabsTrigger value="subagents" data-testid="admin-ws-tab-subagents">
                  Subagents
                </TabsTrigger>
                <TabsTrigger value="workboard" data-testid="admin-ws-tab-workboard">
                  WorkBoard
                </TabsTrigger>
                <TabsTrigger value="sessions" data-testid="admin-ws-tab-sessions">
                  Sessions
                </TabsTrigger>
                <TabsTrigger value="workflows" data-testid="admin-ws-tab-workflows">
                  Workflows
                </TabsTrigger>
                <TabsTrigger value="commands" data-testid="admin-ws-tab-commands">
                  Commands &amp; diagnostics
                </TabsTrigger>
              </TabsList>

              <TabsContent value="subagents">
                <SubagentsPanels core={core} />
              </TabsContent>

              <TabsContent value="workboard">
                <AdminWorkBoardWsHub core={core} />
              </TabsContent>

              <TabsContent value="sessions">
                <section className="grid gap-3" aria-label="Sessions">
                  <div className="text-sm font-medium text-fg">Sessions</div>
                  <JsonWsPanel
                    title="session.send"
                    description="Send a message into a session and receive assistant output."
                    initialPayload={{
                      channel: "test",
                      thread_id: "thread-1",
                      content: "Hello",
                    }}
                    payloadTestId="admin-ws-session-send-payload"
                    submitLabel="Send"
                    submitTestId="admin-ws-session-send-execute"
                    resultHeading="session.send result"
                    resultTestId="admin-ws-session-send-result"
                    onSubmit={async (payload) => {
                      return await core.ws.sessionSend(payload as SessionSendPayload);
                    }}
                  />
                </section>
              </TabsContent>

              <TabsContent value="workflows">
                <section className="grid gap-3" aria-label="Workflows">
                  <div className="text-sm font-medium text-fg">Workflows</div>
                  <div className="grid gap-3">
                    <JsonWsPanel
                      title="workflow.run"
                      description="Start a workflow run."
                      initialPayload={{
                        key: "node:node-1",
                        lane: "main",
                        steps: [{ type: "Decide", args: {} }],
                      }}
                      payloadTestId="admin-ws-workflow-run-payload"
                      submitLabel="Run"
                      submitTestId="admin-ws-workflow-run-execute"
                      resultHeading="workflow.run result"
                      resultTestId="admin-ws-workflow-run-result"
                      onSubmit={async (payload) => {
                        return await core.ws.workflowRun(payload as WorkflowRunPayload);
                      }}
                    />

                    <JsonWsPanel
                      title="workflow.resume"
                      description="Resume a paused workflow run."
                      initialPayload={{ token: "resume-token" }}
                      payloadTestId="admin-ws-workflow-resume-payload"
                      submitLabel="Resume"
                      submitTestId="admin-ws-workflow-resume-execute"
                      resultHeading="workflow.resume result"
                      resultTestId="admin-ws-workflow-resume-result"
                      onSubmit={async (payload) => {
                        return await core.ws.workflowResume(payload as WorkflowResumePayload);
                      }}
                    />

                    <JsonWsPanel
                      title="workflow.cancel"
                      description="Cancel a workflow run."
                      initialPayload={{ run_id: "run-1", reason: "stop" }}
                      payloadTestId="admin-ws-workflow-cancel-payload"
                      submitLabel="Cancel"
                      submitTestId="admin-ws-workflow-cancel-execute"
                      resultHeading="workflow.cancel result"
                      resultTestId="admin-ws-workflow-cancel-result"
                      onSubmit={async (payload) => {
                        return await core.ws.workflowCancel(payload as WorkflowCancelPayload);
                      }}
                    />
                  </div>
                </section>
              </TabsContent>

              <TabsContent value="commands">
                <AdminWsPanels core={core} />
              </TabsContent>
            </Tabs>
          </TabsContent>
        </AdminModeGate>
      </Tabs>
    </div>
  );
}
