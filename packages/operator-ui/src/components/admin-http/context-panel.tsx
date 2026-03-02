import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { optionalString, useApiAction } from "./admin-http-shared.js";

const DEFAULT_RESULT_VIEWER_PROPS = {
  defaultExpandedDepth: 1,
  contentClassName: "max-h-[420px]",
} as const;

function ContextGetTab({ core }: { core: OperatorCore }) {
  const contextApi = core.http.context;
  const [agentId, setAgentId] = React.useState("");
  const action = useApiAction<unknown>();
  const resolvedAgentId = optionalString(agentId);

  return (
    <>
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
              contextApi.get(resolvedAgentId ? { agent_id: resolvedAgentId } : {}),
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
        heading="Get result"
        value={action.value}
        error={action.error}
        jsonViewerProps={DEFAULT_RESULT_VIEWER_PROPS}
      />
    </>
  );
}

function parsePositiveInteger(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : undefined;
}

function ContextListTab({ core }: { core: OperatorCore }) {
  const contextApi = core.http.context;
  const [sessionId, setSessionId] = React.useState("");
  const [runId, setRunId] = React.useState("");
  const [limit, setLimit] = React.useState("");
  const action = useApiAction<unknown>();

  const resolvedSessionId = optionalString(sessionId);
  const resolvedRunId = optionalString(runId);

  const parsedLimit = parsePositiveInteger(limit);
  const invalidLimit = limit.trim() !== "" && typeof parsedLimit !== "number";

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Session id (optional)"
          placeholder="..."
          value={sessionId}
          onChange={(event) => {
            setSessionId(event.target.value);
          }}
        />
        <Input
          label="Run id (optional)"
          placeholder="..."
          value={runId}
          onChange={(event) => {
            setRunId(event.target.value);
          }}
        />
      </div>
      <Input
        label="Limit (optional)"
        type="number"
        min={1}
        value={limit}
        onChange={(event) => {
          setLimit(event.target.value);
        }}
        helperText={invalidLimit ? "Must be a positive integer" : undefined}
        error={invalidLimit ? "Invalid limit" : undefined}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          isLoading={action.isLoading}
          disabled={invalidLimit}
          onClick={() => {
            void action.run(() =>
              contextApi.list({
                ...(resolvedSessionId ? { session_id: resolvedSessionId } : {}),
                ...(resolvedRunId ? { run_id: resolvedRunId } : {}),
                ...(typeof parsedLimit === "number" ? { limit: parsedLimit } : {}),
              }),
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
        heading="List result"
        value={action.value}
        error={action.error}
        jsonViewerProps={DEFAULT_RESULT_VIEWER_PROPS}
      />
    </>
  );
}

function ContextDetailTab({ core }: { core: OperatorCore }) {
  const contextApi = core.http.context;
  const [reportId, setReportId] = React.useState("");
  const action = useApiAction<unknown>();
  const resolvedReportId = optionalString(reportId);

  return (
    <>
      <Input
        label="Context report id"
        placeholder="uuid"
        value={reportId}
        onChange={(event) => {
          setReportId(event.target.value);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          isLoading={action.isLoading}
          disabled={!resolvedReportId}
          onClick={() => {
            if (!resolvedReportId) return;
            void action.run(() => contextApi.detail(resolvedReportId));
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
        heading="Detail result"
        value={action.value}
        error={action.error}
        jsonViewerProps={DEFAULT_RESULT_VIEWER_PROPS}
      />
    </>
  );
}

export function ContextPanel({ core }: { core: OperatorCore }) {
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

          <TabsContent value="get" forceMount className="grid gap-3">
            <ContextGetTab core={core} />
          </TabsContent>

          <TabsContent value="list" forceMount className="grid gap-3">
            <ContextListTab core={core} />
          </TabsContent>

          <TabsContent value="detail" forceMount className="grid gap-3">
            <ContextDetailTab core={core} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
