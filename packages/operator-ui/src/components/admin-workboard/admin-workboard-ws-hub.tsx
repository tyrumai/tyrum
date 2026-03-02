import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { isRecord } from "../../utils/is-record.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import {
  WorkScopeSelector,
  type WorkScopeDraft,
  type WorkScopeErrors,
} from "./work-scope-selector.js";
import { WsJsonPanel } from "./ws-json-panel.js";
import { WorkItemsTable } from "./work-items-table.js";

export interface AdminWorkBoardWsHubProps {
  core: OperatorCore;
}

type WorkListPayload = Parameters<OperatorCore["ws"]["workList"]>[0];
type WorkGetPayload = Parameters<OperatorCore["ws"]["workGet"]>[0];
type WorkCreatePayload = Parameters<OperatorCore["ws"]["workCreate"]>[0];
type WorkUpdatePayload = Parameters<OperatorCore["ws"]["workUpdate"]>[0];
type WorkTransitionPayload = Parameters<OperatorCore["ws"]["workTransition"]>[0];
type WorkListResult = Awaited<ReturnType<OperatorCore["ws"]["workList"]>>;
type WorkSignalListPayload = Parameters<OperatorCore["ws"]["workSignalList"]>[0];
type WorkSignalGetPayload = Parameters<OperatorCore["ws"]["workSignalGet"]>[0];
type WorkSignalCreatePayload = Parameters<OperatorCore["ws"]["workSignalCreate"]>[0];
type WorkSignalUpdatePayload = Parameters<OperatorCore["ws"]["workSignalUpdate"]>[0];
type WorkStateKvGetPayload = Parameters<OperatorCore["ws"]["workStateKvGet"]>[0];
type WorkStateKvListPayload = Parameters<OperatorCore["ws"]["workStateKvList"]>[0];
type WorkStateKvSetPayload = Parameters<OperatorCore["ws"]["workStateKvSet"]>[0];

function renderWorkListResult(result: WorkListResult): React.ReactNode {
  return (
    <div className="grid gap-3">
      <WorkItemsTable data-testid="admin-ws-work-list-table" items={result.items} />
      {result.next_cursor ? (
        <div className="text-xs text-fg-muted">
          next_cursor{" "}
          <code className="break-all rounded bg-bg-subtle px-1 py-0.5 text-fg">
            {result.next_cursor}
          </code>
        </div>
      ) : null}
    </div>
  );
}

export function AdminWorkBoardWsHub({ core }: AdminWorkBoardWsHubProps): React.ReactElement {
  const [scope, setScope] = React.useState<WorkScopeDraft>({
    tenant_id: "",
    agent_id: "",
    workspace_id: "",
  });
  const [scopeErrors, setScopeErrors] = React.useState<WorkScopeErrors>({});

  const buildStateKvPayload = React.useCallback(
    ({
      payload,
      scope: normalizedScope,
    }: {
      payload: Record<string, unknown>;
      scope: WorkScopeDraft;
    }) => {
      const rawScope = payload["scope"];
      const scopePayload = isRecord(rawScope) ? rawScope : {};

      const nextPayload: Record<string, unknown> = {
        ...payload,
        scope: { ...scopePayload, ...normalizedScope },
      };
      delete nextPayload["tenant_id"];
      delete nextPayload["agent_id"];
      delete nextPayload["workspace_id"];
      return nextPayload;
    },
    [],
  );

  return (
    <div className="grid gap-4" data-testid="admin-ws-workboard">
      <Card>
        <CardHeader className="pb-4">
          <div className="text-sm font-medium text-fg">WorkBoard scope</div>
          <div className="text-sm text-fg-muted">
            WorkBoard operations require a tenant, agent, and workspace scope.
          </div>
        </CardHeader>
        <CardContent>
          <WorkScopeSelector
            value={scope}
            errors={scopeErrors}
            onChange={(next) => {
              setScope(next);
              if (Object.keys(scopeErrors).length > 0) {
                setScopeErrors({});
              }
            }}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4">
        <WsJsonPanel
          scope={scope}
          onScopeErrors={setScopeErrors}
          title="work.list"
          payloadTestId="admin-ws-work-list-payload"
          runTestId="admin-ws-work-list-run"
          defaultPayload={{ limit: 50 }}
          run={(payload) => core.ws.workList(payload as WorkListPayload)}
          renderResult={renderWorkListResult}
        />
        <WsJsonPanel
          scope={scope}
          onScopeErrors={setScopeErrors}
          title="work.get"
          payloadTestId="admin-ws-work-get-payload"
          runTestId="admin-ws-work-get-run"
          defaultPayload={{ work_item_id: "" }}
          run={(payload) => core.ws.workGet(payload as WorkGetPayload)}
        />
        <WsJsonPanel
          scope={scope}
          onScopeErrors={setScopeErrors}
          title="work.create"
          payloadTestId="admin-ws-work-create-payload"
          runTestId="admin-ws-work-create-run"
          defaultPayload={{ item: { kind: "action", title: "" } }}
          run={(payload) => core.ws.workCreate(payload as WorkCreatePayload)}
        />
        <WsJsonPanel
          scope={scope}
          onScopeErrors={setScopeErrors}
          title="work.update"
          payloadTestId="admin-ws-work-update-payload"
          runTestId="admin-ws-work-update-run"
          defaultPayload={{ work_item_id: "", patch: { title: "" } }}
          run={(payload) => core.ws.workUpdate(payload as WorkUpdatePayload)}
        />
        <WsJsonPanel
          scope={scope}
          onScopeErrors={setScopeErrors}
          title="work.transition"
          payloadTestId="admin-ws-work-transition-payload"
          runTestId="admin-ws-work-transition-run"
          defaultPayload={{ work_item_id: "", status: "ready", reason: "" }}
          run={(payload) => core.ws.workTransition(payload as WorkTransitionPayload)}
        />
        <WsJsonPanel
          scope={scope}
          onScopeErrors={setScopeErrors}
          title="work.signal.list"
          payloadTestId="admin-ws-work-signal-list-payload"
          runTestId="admin-ws-work-signal-list-run"
          defaultPayload={{ limit: 50 }}
          run={(payload) => core.ws.workSignalList(payload as WorkSignalListPayload)}
        />
        <WsJsonPanel
          scope={scope}
          onScopeErrors={setScopeErrors}
          title="work.signal.get"
          payloadTestId="admin-ws-work-signal-get-payload"
          runTestId="admin-ws-work-signal-get-run"
          defaultPayload={{ signal_id: "" }}
          run={(payload) => core.ws.workSignalGet(payload as WorkSignalGetPayload)}
        />
        <WsJsonPanel
          scope={scope}
          onScopeErrors={setScopeErrors}
          title="work.signal.create"
          payloadTestId="admin-ws-work-signal-create-payload"
          runTestId="admin-ws-work-signal-create-run"
          defaultPayload={{
            signal: {
              trigger_kind: "time",
              trigger_spec_json: {},
              payload_json: {},
              status: "active",
            },
          }}
          run={(payload) => core.ws.workSignalCreate(payload as WorkSignalCreatePayload)}
        />
        <WsJsonPanel
          scope={scope}
          onScopeErrors={setScopeErrors}
          title="work.signal.update"
          payloadTestId="admin-ws-work-signal-update-payload"
          runTestId="admin-ws-work-signal-update-run"
          defaultPayload={{ signal_id: "", patch: { status: "paused" } }}
          run={(payload) => core.ws.workSignalUpdate(payload as WorkSignalUpdatePayload)}
        />
        <WsJsonPanel
          scope={scope}
          onScopeErrors={setScopeErrors}
          title="work.state_kv.get"
          payloadTestId="admin-ws-work-state-kv-get-payload"
          runTestId="admin-ws-work-state-kv-get-run"
          defaultPayload={{ scope: { kind: "agent" }, key: "" }}
          buildPayload={buildStateKvPayload}
          run={(payload) => core.ws.workStateKvGet(payload as WorkStateKvGetPayload)}
        />
        <WsJsonPanel
          scope={scope}
          onScopeErrors={setScopeErrors}
          title="work.state_kv.list"
          payloadTestId="admin-ws-work-state-kv-list-payload"
          runTestId="admin-ws-work-state-kv-list-run"
          defaultPayload={{ scope: { kind: "agent" } }}
          buildPayload={buildStateKvPayload}
          run={(payload) => core.ws.workStateKvList(payload as WorkStateKvListPayload)}
        />
        <WsJsonPanel
          scope={scope}
          onScopeErrors={setScopeErrors}
          title="work.state_kv.set"
          payloadTestId="admin-ws-work-state-kv-set-payload"
          runTestId="admin-ws-work-state-kv-set-run"
          defaultPayload={{ scope: { kind: "agent" }, key: "", value_json: {} }}
          buildPayload={buildStateKvPayload}
          run={(payload) => core.ws.workStateKvSet(payload as WorkStateKvSetPayload)}
        />
      </div>
    </div>
  );
}
