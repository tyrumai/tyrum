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
} from "@tyrum/schemas";
import type { WsMessageEnvelope, WsResponseEnvelope } from "@tyrum/schemas";
import type { ConnectedClient } from "../connection-manager.js";
import { WORKBOARD_WS_AUDIENCE } from "../workboard-audience.js";
import { WorkboardDal } from "../../modules/workboard/dal.js";
import { enqueueWorkItemStateChangeNotification } from "../../modules/workboard/notifications.js";
import type { ProtocolDeps } from "./types.js";
import { broadcastEvent, errorResponse, workboardErrorResponse } from "./helpers.js";

type WsRequestEnvelope = Extract<WsMessageEnvelope, { request_id: string; payload: unknown }>;

export async function handleWorkboardMessage(
  client: ConnectedClient,
  msg: WsRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  if (!msg.type.startsWith("work.")) return undefined;

  if (msg.type === "work.create") {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may create work items",
      );
    }
    if (!deps.db) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "work.create not supported",
      );
    }

    const parsedReq = WsWorkCreateRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    const dal = new WorkboardDal(deps.db, deps.redactionEngine);
    try {
      const scope = parsedReq.data.payload;
      const item = await dal.createItem({
        scope,
        item: parsedReq.data.payload.item,
        createdFromSessionKey: `agent:${scope.agent_id}:main`,
      });

      broadcastEvent(
        {
          event_id: crypto.randomUUID(),
          type: "work.item.created",
          occurred_at: new Date().toISOString(),
          scope: { kind: "agent", agent_id: item.agent_id },
          payload: { item },
        },
        deps,
        WORKBOARD_WS_AUDIENCE,
      );

      await maybeEmitWorkItemOverlapWarningArtifact({ dal, scope, item, deps });

      const result = WsWorkCreateResult.parse({ item });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    } catch (err) {
      return workboardErrorResponse(msg.request_id, msg.type, err, deps);
    }
  }

  if (msg.type === "work.list") {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may list work items",
      );
    }
    if (!deps.db) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "work.list not supported",
      );
    }

    const parsedReq = WsWorkListRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    const dal = new WorkboardDal(deps.db, deps.redactionEngine);
    try {
      const payload = parsedReq.data.payload;
      const { items, next_cursor } = await dal.listItems({
        scope: payload,
        statuses: payload.statuses,
        kinds: payload.kinds,
        limit: payload.limit,
        cursor: payload.cursor,
      });
      const result = WsWorkListResult.parse({ items, next_cursor });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    } catch (err) {
      return workboardErrorResponse(msg.request_id, msg.type, err, deps);
    }
  }

  if (msg.type === "work.get") {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may fetch work items",
      );
    }
    if (!deps.db) {
      return errorResponse(msg.request_id, msg.type, "unsupported_request", "work.get not supported");
    }

    const parsedReq = WsWorkGetRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    const dal = new WorkboardDal(deps.db, deps.redactionEngine);
    try {
      const payload = parsedReq.data.payload;
      const item = await dal.getItem({ scope: payload, work_item_id: payload.work_item_id });
      if (!item) {
        return errorResponse(msg.request_id, msg.type, "not_found", "work item not found");
      }
      const result = WsWorkGetResult.parse({ item });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    } catch (err) {
      return workboardErrorResponse(msg.request_id, msg.type, err, deps);
    }
  }

  if (msg.type === "work.update") {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may update work items",
      );
    }
    if (!deps.db) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "work.update not supported",
      );
    }

    const parsedReq = WsWorkUpdateRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    const dal = new WorkboardDal(deps.db, deps.redactionEngine);
    try {
      const payload = parsedReq.data.payload;
      const item = await dal.updateItem({
        scope: payload,
        work_item_id: payload.work_item_id,
        patch: payload.patch,
      });
      if (!item) {
        return errorResponse(msg.request_id, msg.type, "not_found", "work item not found");
      }

      broadcastEvent(
        {
          event_id: crypto.randomUUID(),
          type: "work.item.updated",
          occurred_at: new Date().toISOString(),
          scope: { kind: "agent", agent_id: item.agent_id },
          payload: { item },
        },
        deps,
        WORKBOARD_WS_AUDIENCE,
      );

      const fingerprintTouched = parsedReq.data.payload.patch.fingerprint !== undefined;
      await maybeEmitWorkItemOverlapWarningArtifact({
        dal,
        scope: payload,
        item,
        deps,
        fingerprintTouched,
      });

      const result = WsWorkUpdateResult.parse({ item });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    } catch (err) {
      return workboardErrorResponse(msg.request_id, msg.type, err, deps);
    }
  }

  if (msg.type === "work.transition") {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may transition work items",
      );
    }
    if (!deps.db) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "work.transition not supported",
      );
    }

    const parsedReq = WsWorkTransitionRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    const dal = new WorkboardDal(deps.db, deps.redactionEngine);
    try {
      const payload = parsedReq.data.payload;
      const item = await dal.transitionItem({
        scope: payload,
        work_item_id: payload.work_item_id,
        status: payload.status,
        reason: payload.reason,
      });
      if (!item) {
        return errorResponse(msg.request_id, msg.type, "not_found", "work item not found");
      }

      const eventType =
        payload.status === "blocked"
          ? "work.item.blocked"
          : payload.status === "done"
            ? "work.item.completed"
            : payload.status === "failed"
              ? "work.item.failed"
              : payload.status === "cancelled"
                ? "work.item.cancelled"
                : "work.item.updated";

      broadcastEvent(
        {
          event_id: crypto.randomUUID(),
          type: eventType,
          occurred_at: new Date().toISOString(),
          scope: { kind: "agent", agent_id: item.agent_id },
          payload: { item },
        },
        deps,
        WORKBOARD_WS_AUDIENCE,
      );

      if (
        payload.status === "done" ||
        payload.status === "blocked" ||
        payload.status === "failed"
      ) {
        try {
          await enqueueWorkItemStateChangeNotification({
            db: deps.db,
            scope: payload,
            item,
            approvalDal: deps.approvalDal,
            policyService: deps.policyService,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          deps.logger?.warn("workboard.notification_failed", {
            work_item_id: item.work_item_id,
            status: payload.status,
            error: message,
          });
        }
      }

      const result = WsWorkTransitionResult.parse({ item });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    } catch (err) {
      return workboardErrorResponse(msg.request_id, msg.type, err, deps);
    }
  }

  if (msg.type === "work.link.create" || msg.type === "work.link.list") {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may manage work item links",
      );
    }
    if (!deps.db) {
      return errorResponse(msg.request_id, msg.type, "unsupported_request", `${msg.type} not supported`);
    }

    const dal = new WorkboardDal(deps.db, deps.redactionEngine);

    if (msg.type === "work.link.create") {
      const parsedReq = WsWorkLinkCreateRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      try {
        const payload = parsedReq.data.payload;
        if (payload.work_item_id === payload.linked_work_item_id) {
          return errorResponse(
            msg.request_id,
            msg.type,
            "invalid_request",
            "work item cannot link to itself",
          );
        }

        const link = await dal.createLink({
          scope: payload,
          work_item_id: payload.work_item_id,
          linked_work_item_id: payload.linked_work_item_id,
          kind: payload.kind,
          meta_json: payload.meta_json,
        });

        broadcastEvent(
          {
            event_id: crypto.randomUUID(),
            type: "work.link.created",
            occurred_at: new Date().toISOString(),
            scope: { kind: "agent", agent_id: payload.agent_id },
            payload: {
              tenant_id: payload.tenant_id,
              agent_id: payload.agent_id,
              workspace_id: payload.workspace_id,
              link,
            },
          },
          deps,
          WORKBOARD_WS_AUDIENCE,
        );

        const result = WsWorkLinkCreateResult.parse({ link });
        return { request_id: msg.request_id, type: msg.type, ok: true, result };
      } catch (err) {
        return workboardErrorResponse(msg.request_id, msg.type, err, deps);
      }
    }

    const parsedReq = WsWorkLinkListRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    try {
      const payload = parsedReq.data.payload;
      const { links } = await dal.listLinks({
        scope: payload,
        work_item_id: payload.work_item_id,
        limit: payload.limit,
      });
      const result = WsWorkLinkListResult.parse({ links });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    } catch (err) {
      return workboardErrorResponse(msg.request_id, msg.type, err, deps);
    }
  }

  if (msg.type === "work.artifact.list" || msg.type === "work.artifact.get" || msg.type === "work.artifact.create") {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may access work artifacts",
      );
    }
    if (!deps.db) {
      return errorResponse(msg.request_id, msg.type, "unsupported_request", `${msg.type} not supported`);
    }

    const dal = new WorkboardDal(deps.db, deps.redactionEngine);

    if (msg.type === "work.artifact.list") {
      const parsedReq = WsWorkArtifactListRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      try {
        const payload = parsedReq.data.payload;
        const { artifacts, next_cursor } = await dal.listArtifacts({
          scope: payload,
          work_item_id: payload.work_item_id,
          limit: payload.limit,
          cursor: payload.cursor,
        });
        const result = WsWorkArtifactListResult.parse({ artifacts, next_cursor });
        return { request_id: msg.request_id, type: msg.type, ok: true, result };
      } catch (err) {
        return workboardErrorResponse(msg.request_id, msg.type, err, deps);
      }
    }

    if (msg.type === "work.artifact.get") {
      const parsedReq = WsWorkArtifactGetRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      try {
        const payload = parsedReq.data.payload;
        const artifact = await dal.getArtifact({
          scope: payload,
          artifact_id: payload.artifact_id,
        });
        if (!artifact) {
          return errorResponse(msg.request_id, msg.type, "not_found", "artifact not found");
        }
        const result = WsWorkArtifactGetResult.parse({ artifact });
        return { request_id: msg.request_id, type: msg.type, ok: true, result };
      } catch (err) {
        return workboardErrorResponse(msg.request_id, msg.type, err, deps);
      }
    }

    const parsedReq = WsWorkArtifactCreateRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    try {
      const payload = parsedReq.data.payload;
      const artifact = await dal.createArtifact({ scope: payload, artifact: payload.artifact });

      broadcastEvent(
        {
          event_id: crypto.randomUUID(),
          type: "work.artifact.created",
          occurred_at: new Date().toISOString(),
          scope: { kind: "agent", agent_id: artifact.agent_id },
          payload: { artifact },
        },
        deps,
        WORKBOARD_WS_AUDIENCE,
      );

      const result = WsWorkArtifactCreateResult.parse({ artifact });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    } catch (err) {
      return workboardErrorResponse(msg.request_id, msg.type, err, deps);
    }
  }

  if (msg.type === "work.decision.list" || msg.type === "work.decision.get" || msg.type === "work.decision.create") {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may access decision records",
      );
    }
    if (!deps.db) {
      return errorResponse(msg.request_id, msg.type, "unsupported_request", `${msg.type} not supported`);
    }

    const dal = new WorkboardDal(deps.db, deps.redactionEngine);

    if (msg.type === "work.decision.list") {
      const parsedReq = WsWorkDecisionListRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      try {
        const payload = parsedReq.data.payload;
        const { decisions, next_cursor } = await dal.listDecisions({
          scope: payload,
          work_item_id: payload.work_item_id,
          limit: payload.limit,
          cursor: payload.cursor,
        });
        const result = WsWorkDecisionListResult.parse({ decisions, next_cursor });
        return { request_id: msg.request_id, type: msg.type, ok: true, result };
      } catch (err) {
        return workboardErrorResponse(msg.request_id, msg.type, err, deps);
      }
    }

    if (msg.type === "work.decision.get") {
      const parsedReq = WsWorkDecisionGetRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      try {
        const payload = parsedReq.data.payload;
        const decision = await dal.getDecision({
          scope: payload,
          decision_id: payload.decision_id,
        });
        if (!decision) {
          return errorResponse(msg.request_id, msg.type, "not_found", "decision not found");
        }
        const result = WsWorkDecisionGetResult.parse({ decision });
        return { request_id: msg.request_id, type: msg.type, ok: true, result };
      } catch (err) {
        return workboardErrorResponse(msg.request_id, msg.type, err, deps);
      }
    }

    const parsedReq = WsWorkDecisionCreateRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    try {
      const payload = parsedReq.data.payload;
      const decision = await dal.createDecision({ scope: payload, decision: payload.decision });

      broadcastEvent(
        {
          event_id: crypto.randomUUID(),
          type: "work.decision.created",
          occurred_at: new Date().toISOString(),
          scope: { kind: "agent", agent_id: decision.agent_id },
          payload: { decision },
        },
        deps,
        WORKBOARD_WS_AUDIENCE,
      );

      const result = WsWorkDecisionCreateResult.parse({ decision });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    } catch (err) {
      return workboardErrorResponse(msg.request_id, msg.type, err, deps);
    }
  }

  if (msg.type === "work.signal.list" || msg.type === "work.signal.get" || msg.type === "work.signal.create" || msg.type === "work.signal.update") {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may access work signals",
      );
    }
    if (!deps.db) {
      return errorResponse(msg.request_id, msg.type, "unsupported_request", `${msg.type} not supported`);
    }

    const dal = new WorkboardDal(deps.db, deps.redactionEngine);

    if (msg.type === "work.signal.list") {
      const parsedReq = WsWorkSignalListRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      try {
        const payload = parsedReq.data.payload;
        const { signals, next_cursor } = await dal.listSignals({
          scope: payload,
          work_item_id: payload.work_item_id,
          statuses: payload.statuses,
          limit: payload.limit,
          cursor: payload.cursor,
        });
        const result = WsWorkSignalListResult.parse({ signals, next_cursor });
        return { request_id: msg.request_id, type: msg.type, ok: true, result };
      } catch (err) {
        return workboardErrorResponse(msg.request_id, msg.type, err, deps);
      }
    }

    if (msg.type === "work.signal.get") {
      const parsedReq = WsWorkSignalGetRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      try {
        const payload = parsedReq.data.payload;
        const signal = await dal.getSignal({ scope: payload, signal_id: payload.signal_id });
        if (!signal) {
          return errorResponse(msg.request_id, msg.type, "not_found", "signal not found");
        }
        const result = WsWorkSignalGetResult.parse({ signal });
        return { request_id: msg.request_id, type: msg.type, ok: true, result };
      } catch (err) {
        return workboardErrorResponse(msg.request_id, msg.type, err, deps);
      }
    }

    if (msg.type === "work.signal.create") {
      const parsedReq = WsWorkSignalCreateRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      try {
        const payload = parsedReq.data.payload;
        const signal = await dal.createSignal({ scope: payload, signal: payload.signal });

        broadcastEvent(
          {
            event_id: crypto.randomUUID(),
            type: "work.signal.created",
            occurred_at: new Date().toISOString(),
            scope: { kind: "agent", agent_id: signal.agent_id },
            payload: { signal },
          },
          deps,
          WORKBOARD_WS_AUDIENCE,
        );

        const result = WsWorkSignalCreateResult.parse({ signal });
        return { request_id: msg.request_id, type: msg.type, ok: true, result };
      } catch (err) {
        return workboardErrorResponse(msg.request_id, msg.type, err, deps);
      }
    }

    const parsedReq = WsWorkSignalUpdateRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    try {
      const payload = parsedReq.data.payload;
      const signal = await dal.updateSignal({
        scope: payload,
        signal_id: payload.signal_id,
        patch: payload.patch,
      });
      if (!signal) {
        return errorResponse(msg.request_id, msg.type, "not_found", "signal not found");
      }

      broadcastEvent(
        {
          event_id: crypto.randomUUID(),
          type: "work.signal.updated",
          occurred_at: new Date().toISOString(),
          scope: { kind: "agent", agent_id: signal.agent_id },
          payload: { signal },
        },
        deps,
        WORKBOARD_WS_AUDIENCE,
      );

      const result = WsWorkSignalUpdateResult.parse({ signal });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    } catch (err) {
      return workboardErrorResponse(msg.request_id, msg.type, err, deps);
    }
  }

  if (msg.type === "work.state_kv.get" || msg.type === "work.state_kv.list" || msg.type === "work.state_kv.set") {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may access work state kv",
      );
    }
    if (!deps.db) {
      return errorResponse(msg.request_id, msg.type, "unsupported_request", `${msg.type} not supported`);
    }

    const dal = new WorkboardDal(deps.db, deps.redactionEngine);

    if (msg.type === "work.state_kv.get") {
      const parsedReq = WsWorkStateKvGetRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      try {
        const payload = parsedReq.data.payload;
        const entry = (await dal.getStateKv({ scope: payload.scope, key: payload.key })) ?? null;
        const result = WsWorkStateKvGetResult.parse({ entry });
        return { request_id: msg.request_id, type: msg.type, ok: true, result };
      } catch (err) {
        return workboardErrorResponse(msg.request_id, msg.type, err, deps);
      }
    }

    if (msg.type === "work.state_kv.list") {
      const parsedReq = WsWorkStateKvListRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      try {
        const payload = parsedReq.data.payload;
        const { entries } = await dal.listStateKv({ scope: payload.scope, prefix: payload.prefix });
        const result = WsWorkStateKvListResult.parse({ entries });
        return { request_id: msg.request_id, type: msg.type, ok: true, result };
      } catch (err) {
        return workboardErrorResponse(msg.request_id, msg.type, err, deps);
      }
    }

    const parsedReq = WsWorkStateKvSetRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    try {
      const payload = parsedReq.data.payload;
      const entry = await dal.setStateKv({
        scope: payload.scope,
        key: payload.key,
        value_json: payload.value_json,
        provenance_json: payload.provenance_json,
      });

      broadcastEvent(
        {
          event_id: crypto.randomUUID(),
          type: "work.state_kv.updated",
          occurred_at: new Date().toISOString(),
          scope: { kind: "agent", agent_id: payload.scope.agent_id },
          payload: { scope: payload.scope, key: payload.key, updated_at: entry.updated_at },
        },
        deps,
        WORKBOARD_WS_AUDIENCE,
      );

      const result = WsWorkStateKvSetResult.parse({ entry });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    } catch (err) {
      return workboardErrorResponse(msg.request_id, msg.type, err, deps);
    }
  }

  return undefined;
}

async function maybeEmitWorkItemOverlapWarningArtifact(params: {
  dal: WorkboardDal;
  scope: Parameters<WorkboardDal["listItems"]>[0]["scope"];
  item: { work_item_id: string; title: string; fingerprint?: { resources: string[] } };
  deps: ProtocolDeps;
  fingerprintTouched?: boolean;
}): Promise<void> {
  try {
    if (params.fingerprintTouched === false) return;

    const fingerprint = params.item.fingerprint;
    if (!fingerprint || fingerprint.resources.length === 0) return;

    const { items: active } = await params.dal.listItems({
      scope: params.scope,
      statuses: ["doing", "blocked"],
      limit: 200,
    });

    const resourceSet = new Set(fingerprint.resources);
    const overlaps = active
      .filter((other) => other.work_item_id !== params.item.work_item_id)
      .map((other) => {
        const otherResources = other.fingerprint?.resources ?? [];
        const shared = otherResources.filter((r) => resourceSet.has(r));
        return shared.length > 0 ? { other, shared } : null;
      })
      .filter(
        (entry): entry is { other: (typeof active)[number]; shared: string[] } => entry !== null,
      );

    if (overlaps.length === 0) return;

    const body_md = [
      `Detected overlap with active WorkItems (no auto-merge):`,
      ``,
      ...overlaps.map(
        ({ other, shared }) =>
          `- \`${other.work_item_id}\` — ${other.title} (shared: ${shared.join(", ")})`,
      ),
      ``,
      `Suggested next steps: queue this WorkItem, link it as a dependency, or explicitly merge.`,
    ].join("\n");

    const artifact = await params.dal.createArtifact({
      scope: params.scope,
      artifact: {
        work_item_id: params.item.work_item_id,
        kind: "risk",
        title: "WorkItem overlap detected",
        body_md,
      },
    });

    broadcastEvent(
      {
        event_id: crypto.randomUUID(),
        type: "work.artifact.created",
        occurred_at: new Date().toISOString(),
        scope: { kind: "agent", agent_id: artifact.agent_id },
        payload: { artifact },
      },
      params.deps,
      WORKBOARD_WS_AUDIENCE,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    params.deps.logger?.warn("work.item.overlap_warning_failed", { error: message });
  }
}
