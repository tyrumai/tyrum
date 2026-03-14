import {
  WsWorkArtifactCreateRequest,
  WsWorkArtifactCreateResult,
  WsWorkArtifactGetRequest,
  WsWorkArtifactGetResult,
  WsWorkArtifactListRequest,
  WsWorkArtifactListResult,
  WsWorkCreateRequest,
  WsWorkCreateResult,
  WsWorkDecisionCreateRequest,
  WsWorkDecisionCreateResult,
  WsWorkDecisionGetRequest,
  WsWorkDecisionGetResult,
  WsWorkDecisionListRequest,
  WsWorkDecisionListResult,
  WsWorkGetRequest,
  WsWorkGetResult,
  WsWorkLinkCreateRequest,
  WsWorkLinkCreateResult,
  WsWorkLinkListRequest,
  WsWorkLinkListResult,
  WsWorkListRequest,
  WsWorkListResult,
  WsWorkSignalCreateRequest,
  WsWorkSignalCreateResult,
  WsWorkSignalGetRequest,
  WsWorkSignalGetResult,
  WsWorkSignalListRequest,
  WsWorkSignalListResult,
  WsWorkSignalUpdateRequest,
  WsWorkSignalUpdateResult,
  WsWorkStateKvGetRequest,
  WsWorkStateKvGetResult,
  WsWorkStateKvListRequest,
  WsWorkStateKvListResult,
  WsWorkStateKvSetRequest,
  WsWorkStateKvSetResult,
  WsWorkTransitionRequest,
  WsWorkTransitionResult,
  WsWorkUpdateRequest,
  WsWorkUpdateResult,
  type WsResponseEnvelope,
} from "@tyrum/schemas";
import type { ConnectedClient } from "../connection-manager.js";
import { enqueueWorkItemStateChangeNotification } from "../../modules/workboard/notifications.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";
import { errorResponse } from "./helpers.js";
import {
  broadcastAgentEvent,
  createHandler,
  ensureStateKvScope,
  ensureWorkScope,
  getWorkTransitionEventType,
  notFound,
  okResult,
  resolveExistingStateKvScope,
  resolveExistingWorkScope,
  type ScopedHandlerContext,
  type WorkboardHandler,
  type WorkScope,
  type TransitionItem,
} from "./workboard-handlers-shared.js";
import { maybeEmitWorkItemOverlapWarningArtifact } from "./workboard-overlap-warning.js";

async function maybeEnqueueTransitionNotification(params: {
  ctx: ScopedHandlerContext;
  scope: WorkScope;
  item: TransitionItem;
  status: string;
}): Promise<void> {
  if (params.status !== "done" && params.status !== "blocked" && params.status !== "failed") return;
  try {
    await enqueueWorkItemStateChangeNotification({
      db: params.ctx.db,
      scope: params.scope,
      item: params.item,
      approvalDal: params.ctx.deps.approvalDal,
      policyService: params.ctx.deps.policyService,
      protocolDeps: params.ctx.deps,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    params.ctx.deps.logger?.warn("workboard.notification_failed", {
      request_id: params.ctx.msg.request_id,
      client_id: params.ctx.client.id,
      request_type: params.ctx.msg.type,
      work_item_id: params.item.work_item_id,
      status: params.status,
      error: message,
    });
  }
}

const workboardHandlers: Record<string, WorkboardHandler> = {
  "work.create": createHandler({
    action: "create work items",
    unsupportedMessage: "work.create not supported",
    schema: WsWorkCreateRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const { scope, keys } = await ensureWorkScope({ deps, tenantId, payload });
      const item = await dal.createItem({
        scope,
        item: payload.item,
        createdFromSessionKey: `agent:${keys.agentKey}:main`,
      });
      broadcastAgentEvent(scope.tenant_id, "work.item.created", item.agent_id, { item }, deps);
      await maybeEmitWorkItemOverlapWarningArtifact({ dal, scope, item, deps });
      return okResult(msg, WsWorkCreateResult.parse({ item }));
    },
  }),
  "work.list": createHandler({
    action: "list work items",
    unsupportedMessage: "work.list not supported",
    schema: WsWorkListRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const { items, next_cursor } = await dal.listItems({
        scope,
        statuses: payload.statuses,
        kinds: payload.kinds,
        limit: payload.limit,
        cursor: payload.cursor,
      });
      return okResult(msg, WsWorkListResult.parse({ items, next_cursor }));
    },
  }),
  "work.get": createHandler({
    action: "fetch work items",
    unsupportedMessage: "work.get not supported",
    schema: WsWorkGetRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const item = await dal.getItem({ scope, work_item_id: payload.work_item_id });
      return item ? okResult(msg, WsWorkGetResult.parse({ item })) : notFound(msg, "work item");
    },
  }),
  "work.update": createHandler({
    action: "update work items",
    unsupportedMessage: "work.update not supported",
    schema: WsWorkUpdateRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const item = await dal.updateItem({
        scope,
        work_item_id: payload.work_item_id,
        patch: payload.patch,
      });
      if (!item) return notFound(msg, "work item");
      broadcastAgentEvent(scope.tenant_id, "work.item.updated", item.agent_id, { item }, deps);
      await maybeEmitWorkItemOverlapWarningArtifact({
        dal,
        scope,
        item,
        deps,
        fingerprintTouched: payload.patch.fingerprint !== undefined,
      });
      return okResult(msg, WsWorkUpdateResult.parse({ item }));
    },
  }),
  "work.transition": createHandler({
    action: "transition work items",
    unsupportedMessage: "work.transition not supported",
    schema: WsWorkTransitionRequest,
    run: async (ctx, payload) => {
      const { msg, deps, tenantId, dal } = ctx;
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const item = await dal.transitionItem({
        scope,
        work_item_id: payload.work_item_id,
        status: payload.status,
        reason: payload.reason,
      });
      if (!item) return notFound(msg, "work item");
      broadcastAgentEvent(
        scope.tenant_id,
        getWorkTransitionEventType(payload.status),
        item.agent_id,
        { item },
        deps,
      );
      await maybeEnqueueTransitionNotification({ ctx, scope, item, status: payload.status });
      return okResult(msg, WsWorkTransitionResult.parse({ item }));
    },
  }),
  "work.link.create": createHandler({
    action: "manage work item links",
    schema: WsWorkLinkCreateRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      if (payload.work_item_id === payload.linked_work_item_id) {
        return errorResponse(
          msg.request_id,
          msg.type,
          "invalid_request",
          "work item cannot link to itself",
        );
      }
      const link = await dal.createLink({
        scope,
        work_item_id: payload.work_item_id,
        linked_work_item_id: payload.linked_work_item_id,
        kind: payload.kind,
        meta_json: payload.meta_json,
      });
      broadcastAgentEvent(
        scope.tenant_id,
        "work.link.created",
        scope.agent_id,
        {
          tenant_id: scope.tenant_id,
          agent_id: scope.agent_id,
          workspace_id: scope.workspace_id,
          link,
        },
        deps,
      );
      return okResult(msg, WsWorkLinkCreateResult.parse({ link }));
    },
  }),
  "work.link.list": createHandler({
    action: "manage work item links",
    schema: WsWorkLinkListRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const { links } = await dal.listLinks({
        scope,
        work_item_id: payload.work_item_id,
        limit: payload.limit,
      });
      return okResult(msg, WsWorkLinkListResult.parse({ links }));
    },
  }),
  "work.artifact.list": createHandler({
    action: "access work artifacts",
    schema: WsWorkArtifactListRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const { artifacts, next_cursor } = await dal.listArtifacts({
        scope,
        work_item_id: payload.work_item_id,
        limit: payload.limit,
        cursor: payload.cursor,
      });
      return okResult(msg, WsWorkArtifactListResult.parse({ artifacts, next_cursor }));
    },
  }),
  "work.artifact.get": createHandler({
    action: "access work artifacts",
    schema: WsWorkArtifactGetRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const artifact = await dal.getArtifact({ scope, artifact_id: payload.artifact_id });
      return artifact
        ? okResult(msg, WsWorkArtifactGetResult.parse({ artifact }))
        : notFound(msg, "artifact");
    },
  }),
  "work.artifact.create": createHandler({
    action: "access work artifacts",
    schema: WsWorkArtifactCreateRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const artifact = await dal.createArtifact({ scope, artifact: payload.artifact });
      broadcastAgentEvent(
        scope.tenant_id,
        "work.artifact.created",
        artifact.agent_id,
        { artifact },
        deps,
      );
      return okResult(msg, WsWorkArtifactCreateResult.parse({ artifact }));
    },
  }),
  "work.decision.list": createHandler({
    action: "access decision records",
    schema: WsWorkDecisionListRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const { decisions, next_cursor } = await dal.listDecisions({
        scope,
        work_item_id: payload.work_item_id,
        limit: payload.limit,
        cursor: payload.cursor,
      });
      return okResult(msg, WsWorkDecisionListResult.parse({ decisions, next_cursor }));
    },
  }),
  "work.decision.get": createHandler({
    action: "access decision records",
    schema: WsWorkDecisionGetRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const decision = await dal.getDecision({ scope, decision_id: payload.decision_id });
      return decision
        ? okResult(msg, WsWorkDecisionGetResult.parse({ decision }))
        : notFound(msg, "decision");
    },
  }),
  "work.decision.create": createHandler({
    action: "access decision records",
    schema: WsWorkDecisionCreateRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const decision = await dal.createDecision({ scope, decision: payload.decision });
      broadcastAgentEvent(
        scope.tenant_id,
        "work.decision.created",
        decision.agent_id,
        { decision },
        deps,
      );
      return okResult(msg, WsWorkDecisionCreateResult.parse({ decision }));
    },
  }),
  "work.signal.list": createHandler({
    action: "access work signals",
    schema: WsWorkSignalListRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const { signals, next_cursor } = await dal.listSignals({
        scope,
        work_item_id: payload.work_item_id,
        statuses: payload.statuses,
        limit: payload.limit,
        cursor: payload.cursor,
      });
      return okResult(msg, WsWorkSignalListResult.parse({ signals, next_cursor }));
    },
  }),
  "work.signal.get": createHandler({
    action: "access work signals",
    schema: WsWorkSignalGetRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const signal = await dal.getSignal({ scope, signal_id: payload.signal_id });
      return signal
        ? okResult(msg, WsWorkSignalGetResult.parse({ signal }))
        : notFound(msg, "signal");
    },
  }),
  "work.signal.create": createHandler({
    action: "access work signals",
    schema: WsWorkSignalCreateRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const signal = await dal.createSignal({ scope, signal: payload.signal });
      broadcastAgentEvent(
        scope.tenant_id,
        "work.signal.created",
        signal.agent_id,
        { signal },
        deps,
      );
      return okResult(msg, WsWorkSignalCreateResult.parse({ signal }));
    },
  }),
  "work.signal.update": createHandler({
    action: "access work signals",
    schema: WsWorkSignalUpdateRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const updated = await dal.updateSignal({
        scope,
        signal_id: payload.signal_id,
        patch: payload.patch,
      });
      if (!updated) return notFound(msg, "signal");
      if (updated.changed) {
        broadcastAgentEvent(
          scope.tenant_id,
          "work.signal.updated",
          updated.signal.agent_id,
          {
            signal: updated.signal,
          },
          deps,
        );
      }
      return okResult(msg, WsWorkSignalUpdateResult.parse({ signal: updated.signal }));
    },
  }),
  "work.state_kv.get": createHandler({
    action: "access work state kv",
    schema: WsWorkStateKvGetRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const scope = await resolveExistingStateKvScope(deps, tenantId, payload.scope);
      const entry = (await dal.getStateKv({ scope, key: payload.key })) ?? null;
      return okResult(msg, WsWorkStateKvGetResult.parse({ entry }));
    },
  }),
  "work.state_kv.list": createHandler({
    action: "access work state kv",
    schema: WsWorkStateKvListRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const scope = await resolveExistingStateKvScope(deps, tenantId, payload.scope);
      const { entries } = await dal.listStateKv({ scope, prefix: payload.prefix });
      return okResult(msg, WsWorkStateKvListResult.parse({ entries }));
    },
  }),
  "work.state_kv.set": createHandler({
    action: "access work state kv",
    schema: WsWorkStateKvSetRequest,
    run: async ({ msg, deps, tenantId, dal }, payload) => {
      const scope = await ensureStateKvScope(deps, tenantId, payload.scope);
      const entry = await dal.setStateKv({
        scope,
        key: payload.key,
        value_json: payload.value_json,
        provenance_json: payload.provenance_json,
      });
      broadcastAgentEvent(
        scope.tenant_id,
        "work.state_kv.updated",
        scope.agent_id,
        {
          scope: payload.scope,
          key: payload.key,
          updated_at: entry.updated_at,
        },
        deps,
      );
      return okResult(msg, WsWorkStateKvSetResult.parse({ entry }));
    },
  }),
};

export async function handleWorkboardMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  if (!msg.type.startsWith("work.")) return undefined;
  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }
  const handler = workboardHandlers[msg.type];
  return handler ? handler({ client, msg, deps, tenantId }) : undefined;
}
