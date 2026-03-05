import {
  WsMemoryCreateRequest,
  WsMemoryCreateResult,
  WsMemoryDeleteRequest,
  WsMemoryDeleteResult,
  WsMemoryExportRequest,
  WsMemoryExportResult,
  WsMemoryForgetRequest,
  WsMemoryForgetResult,
  WsMemoryGetRequest,
  WsMemoryGetResult,
  WsMemoryListRequest,
  WsMemoryListResult,
  WsMemorySearchRequest,
  WsMemorySearchResult,
  WsMemoryUpdateRequest,
  WsMemoryUpdateResult,
} from "@tyrum/schemas";
import type { WsResponseEnvelope } from "@tyrum/schemas";
import type { WsBroadcastAudience } from "../audience.js";
import type { ConnectedClient } from "../connection-manager.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";
import { broadcastEvent, errorResponse } from "./helpers.js";
import { IdentityScopeDal } from "../../modules/identity/scope.js";

const OPERATOR_MEMORY_EVENT_AUDIENCE = {
  roles: ["client"],
  required_scopes: ["operator.read"],
} as const satisfies WsBroadcastAudience;

async function maybeRunMemoryV1BudgetConsolidation(params: {
  deps: ProtocolDeps;
  op: "create" | "update";
  tenantId: string;
  agentId: string;
  memoryItemId: string;
}): Promise<void> {
  if (!params.deps.memoryV1BudgetsProvider) return;
  if (!params.deps.memoryV1Dal) return;
  try {
    const budgets = await params.deps.memoryV1BudgetsProvider(params.tenantId, params.agentId);
    const consolidation = await params.deps.memoryV1Dal.consolidateToBudgets({
      tenantId: params.tenantId,
      budgets,
      agentId: params.agentId,
    });

    for (const created of consolidation.created_items) {
      broadcastEvent(
        params.tenantId,
        {
          event_id: crypto.randomUUID(),
          type: "memory.item.created",
          occurred_at: created.created_at,
          payload: { item: created },
        },
        params.deps,
        OPERATOR_MEMORY_EVENT_AUDIENCE,
      );
    }

    for (const tombstone of consolidation.deleted_tombstones) {
      broadcastEvent(
        params.tenantId,
        {
          event_id: crypto.randomUUID(),
          type: "memory.item.deleted",
          occurred_at: tombstone.deleted_at,
          payload: { tombstone },
        },
        params.deps,
        OPERATOR_MEMORY_EVENT_AUDIENCE,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    params.deps.logger?.error("memory.v1.consolidation_failed", {
      op: params.op,
      agent_id: params.agentId,
      memory_item_id: params.memoryItemId,
      error: message,
    });
  }
}

export async function handleMemoryMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  if (
    msg.type !== "memory.search" &&
    msg.type !== "memory.list" &&
    msg.type !== "memory.get" &&
    msg.type !== "memory.create" &&
    msg.type !== "memory.update" &&
    msg.type !== "memory.delete" &&
    msg.type !== "memory.forget" &&
    msg.type !== "memory.export"
  ) {
    return undefined;
  }

  if (client.role !== "client") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only operator clients may access memory APIs",
    );
  }

  if (!deps.memoryV1Dal) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "memory v1 not supported",
    );
  }

  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }
  if (!deps.db) {
    return errorResponse(msg.request_id, msg.type, "unsupported_request", "db not available");
  }
  const identityScopeDal = deps.identityScopeDal ?? new IdentityScopeDal(deps.db);
  const agentId = await identityScopeDal.ensureAgentId(tenantId, "default");
  const scope = { tenantId, agentId };

  try {
    if (msg.type === "memory.search") {
      const parsedReq = WsMemorySearchRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      const payload = parsedReq.data.payload;
      const limit = Math.max(1, Math.min(500, payload.limit ?? 50));
      const res = await deps.memoryV1Dal.search({ ...payload, limit }, scope);
      const result = WsMemorySearchResult.parse(res);
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    }

    if (msg.type === "memory.list") {
      const parsedReq = WsMemoryListRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      const payload = parsedReq.data.payload;
      const limit = Math.max(1, Math.min(500, payload.limit ?? 50));
      const res = await deps.memoryV1Dal.list({
        tenantId,
        agentId,
        filter: payload.filter,
        limit,
        cursor: payload.cursor,
      });
      const result = WsMemoryListResult.parse({
        v: 1,
        items: res.items,
        ...(res.next_cursor ? { next_cursor: res.next_cursor } : {}),
      });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    }

    if (msg.type === "memory.get") {
      const parsedReq = WsMemoryGetRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      const item = await deps.memoryV1Dal.getById(parsedReq.data.payload.memory_item_id, scope);
      if (!item) {
        return errorResponse(msg.request_id, msg.type, "not_found", "memory item not found");
      }

      const result = WsMemoryGetResult.parse({ v: 1, item });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    }

    if (msg.type === "memory.create") {
      const parsedReq = WsMemoryCreateRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      const item = await deps.memoryV1Dal.create(parsedReq.data.payload.item, scope);
      const result = WsMemoryCreateResult.parse({ v: 1, item });

      broadcastEvent(
        tenantId,
        {
          event_id: crypto.randomUUID(),
          type: "memory.item.created",
          occurred_at: item.created_at,
          payload: { item },
        },
        deps,
        OPERATOR_MEMORY_EVENT_AUDIENCE,
      );

      await maybeRunMemoryV1BudgetConsolidation({
        deps,
        op: "create",
        tenantId,
        agentId: item.agent_id,
        memoryItemId: item.memory_item_id,
      });

      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    }

    if (msg.type === "memory.update") {
      const parsedReq = WsMemoryUpdateRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      const payload = parsedReq.data.payload;
      const item = await deps.memoryV1Dal.update(payload.memory_item_id, payload.patch, scope);
      const result = WsMemoryUpdateResult.parse({ v: 1, item });

      broadcastEvent(
        tenantId,
        {
          event_id: crypto.randomUUID(),
          type: "memory.item.updated",
          occurred_at: item.updated_at ?? new Date().toISOString(),
          payload: { item },
        },
        deps,
        OPERATOR_MEMORY_EVENT_AUDIENCE,
      );

      await maybeRunMemoryV1BudgetConsolidation({
        deps,
        op: "update",
        tenantId,
        agentId: item.agent_id,
        memoryItemId: item.memory_item_id,
      });

      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    }

    if (msg.type === "memory.delete") {
      const parsedReq = WsMemoryDeleteRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      const payload = parsedReq.data.payload;
      const tombstone = await deps.memoryV1Dal.delete(
        payload.memory_item_id,
        { deleted_by: "operator", reason: payload.reason },
        scope,
      );
      const result = WsMemoryDeleteResult.parse({ v: 1, tombstone });

      broadcastEvent(
        tenantId,
        {
          event_id: crypto.randomUUID(),
          type: "memory.item.deleted",
          occurred_at: tombstone.deleted_at,
          payload: { tombstone },
        },
        deps,
        OPERATOR_MEMORY_EVENT_AUDIENCE,
      );

      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    }

    if (msg.type === "memory.forget") {
      const parsedReq = WsMemoryForgetRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      const payload = parsedReq.data.payload;
      const outcome = await deps.memoryV1Dal.forget({
        tenantId,
        agentId,
        selectors: payload.selectors,
        deleted_by: "operator",
      });
      const result = WsMemoryForgetResult.parse({
        v: 1,
        deleted_count: outcome.deleted_count,
        tombstones: outcome.tombstones,
      });

      for (const tombstone of outcome.tombstones) {
        broadcastEvent(
          tenantId,
          {
            event_id: crypto.randomUUID(),
            type: "memory.item.forgotten",
            occurred_at: tombstone.deleted_at,
            payload: { tombstone },
          },
          deps,
          OPERATOR_MEMORY_EVENT_AUDIENCE,
        );
      }

      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    }

    const parsedReq = WsMemoryExportRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    if (!deps.artifactStore) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "memory.export not supported",
      );
    }

    const payload = parsedReq.data.payload;

    const items: unknown[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await deps.memoryV1Dal.list({
        tenantId,
        agentId,
        filter: payload.filter,
        limit: 200,
        cursor,
      });
      items.push(...page.items);
      cursor = page.next_cursor;
      if (!cursor) break;
    }

    const tombstones: unknown[] = [];
    if (payload.include_tombstones) {
      let tCursor: string | undefined;
      for (;;) {
        const page = await deps.memoryV1Dal.listTombstones({
          tenantId,
          agentId,
          limit: 200,
          cursor: tCursor,
        });
        tombstones.push(...page.tombstones);
        tCursor = page.next_cursor;
        if (!tCursor) break;
      }
    }

    const exportedAt = new Date().toISOString();
    const exportArtifact = {
      v: 1,
      exported_at: exportedAt,
      filter: payload.filter,
      include_tombstones: payload.include_tombstones,
      items,
      ...(payload.include_tombstones ? { tombstones } : {}),
    };

    const ref = await deps.artifactStore.put({
      kind: "file",
      body: Buffer.from(JSON.stringify(exportArtifact, null, 2), "utf8"),
      mime_type: "application/json",
      labels: ["memory", "memory_v1", "export"],
    });

    const result = WsMemoryExportResult.parse({ v: 1, artifact_id: ref.artifact_id });

    broadcastEvent(
      tenantId,
      {
        event_id: crypto.randomUUID(),
        type: "memory.export.completed",
        occurred_at: exportedAt,
        payload: { artifact_id: ref.artifact_id },
      },
      deps,
      OPERATOR_MEMORY_EVENT_AUDIENCE,
    );

    return { request_id: msg.request_id, type: msg.type, ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorCode =
      err &&
      typeof err === "object" &&
      "code" in err &&
      typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : undefined;
    if (message === "memory item not found") {
      return errorResponse(msg.request_id, msg.type, "not_found", "memory item not found");
    }
    if (message === "invalid cursor") {
      return errorResponse(msg.request_id, msg.type, "invalid_request", "invalid cursor");
    }
    if (message.startsWith("incompatible patch fields for kind=")) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", message);
    }
    if (errorCode === "invalid_request") {
      return errorResponse(msg.request_id, msg.type, "invalid_request", message);
    }
    deps.logger?.error("ws.memory_request_failed", {
      request_id: msg.request_id,
      client_id: client.id,
      request_type: msg.type,
      error: message,
      error_code: errorCode,
    });
    return errorResponse(msg.request_id, msg.type, "internal_error", message);
  }
}
