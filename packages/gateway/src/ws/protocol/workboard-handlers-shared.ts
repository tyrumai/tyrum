import type { WorkItem, WsResponseEnvelope } from "@tyrum/contracts";
import type { ConnectedClient } from "../connection-manager.js";
import { WORKBOARD_WS_AUDIENCE } from "../workboard-audience.js";
import {
  DEFAULT_WORKSPACE_KEY,
  IdentityScopeDal,
  ScopeNotFoundError,
  resolveRequestedAgentKey,
} from "../../app/modules/identity/scope.js";
import { createGatewayWorkboardService } from "../../app/modules/workboard/service.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";
import { broadcastEvent, errorResponse, workboardErrorResponse } from "./helpers.js";

export type ScopeKeysPayload = { tenant_key?: string; agent_key?: string; workspace_key?: string };
type WorkboardService = ReturnType<typeof createGatewayWorkboardService>;

async function buildWorkScope(params: {
  deps: ProtocolDeps;
  tenantId: string;
  payload: ScopeKeysPayload;
  resolveOnly: boolean;
}): Promise<{
  scope: { tenant_id: string; agent_id: string; workspace_id: string };
  keys: { agentKey: string; workspaceKey: string };
}> {
  if (!params.deps.db) throw new Error("db is required");
  const identityScopeDal = params.deps.identityScopeDal ?? new IdentityScopeDal(params.deps.db);
  const agentKey = await resolveRequestedAgentKey({
    identityScopeDal,
    tenantId: params.tenantId,
    agentKey: params.payload.agent_key,
  });
  const explicitWorkspaceKey = params.payload.workspace_key?.trim();
  const workspaceKey = explicitWorkspaceKey || DEFAULT_WORKSPACE_KEY;
  const tenantId = params.tenantId.trim();
  let agentId: string;
  let workspaceId: string;

  if (params.resolveOnly) {
    const resolved = await identityScopeDal.resolveExistingScopeIdsForTenant({
      tenantId,
      agentKey,
      workspaceKey,
    });
    if (!resolved) {
      throw new ScopeNotFoundError("scope not found", {
        agent_key: agentKey,
        workspace_key: workspaceKey,
      });
    }
    agentId = resolved.agentId;
    workspaceId = resolved.workspaceId;
  } else {
    const resolvedAgentId = await identityScopeDal.resolveAgentId(tenantId, agentKey);
    if (!resolvedAgentId) {
      throw new ScopeNotFoundError(`agent '${agentKey}' not found`, {
        agent_key: agentKey,
      });
    }
    agentId = resolvedAgentId;
    if (explicitWorkspaceKey) {
      const resolvedWorkspaceId = await identityScopeDal.resolveWorkspaceId(tenantId, workspaceKey);
      if (!resolvedWorkspaceId) {
        throw new ScopeNotFoundError(`workspace '${workspaceKey}' not found`, {
          workspace_key: workspaceKey,
        });
      }
      workspaceId = resolvedWorkspaceId;
    } else {
      workspaceId = await identityScopeDal.ensureWorkspaceId(tenantId, workspaceKey);
    }
    await identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);
  }
  return {
    keys: { agentKey, workspaceKey },
    scope: { tenant_id: tenantId, agent_id: agentId, workspace_id: workspaceId },
  };
}

export async function ensureWorkScope(params: {
  deps: ProtocolDeps;
  tenantId: string;
  payload: ScopeKeysPayload;
}) {
  return await buildWorkScope({ ...params, resolveOnly: false });
}

export async function resolveExistingWorkScope(params: {
  deps: ProtocolDeps;
  tenantId: string;
  payload: ScopeKeysPayload;
}) {
  return await buildWorkScope({ ...params, resolveOnly: true });
}

export type WorkScope = Awaited<ReturnType<typeof ensureWorkScope>>["scope"];
export type TransitionItem = WorkItem;
export type StateKvScopePayload = ScopeKeysPayload &
  ({ kind: "agent" } | { kind: "work_item"; work_item_id: string });
export type RequestSchema<T> = {
  safeParse(
    input: unknown,
  ): { success: true; data: T } | { success: false; error: { message: string; issues: unknown } };
};
export type ClientRequestContext = {
  client: ConnectedClient;
  msg: ProtocolRequestEnvelope;
  deps: ProtocolDeps;
  tenantId: string;
};
export type ScopedHandlerContext = ClientRequestContext & {
  workboardService: WorkboardService;
  db: NonNullable<ProtocolDeps["db"]>;
};
export type WorkboardHandler = (ctx: ClientRequestContext) => Promise<WsResponseEnvelope>;

export function requireClientWorkboardAccess(
  ctx: ClientRequestContext,
  action: string,
  unsupportedMessage?: string,
): ScopedHandlerContext | WsResponseEnvelope {
  if (ctx.client.role !== "client")
    return errorResponse(
      ctx.msg.request_id,
      ctx.msg.type,
      "unauthorized",
      `only operator clients may ${action}`,
    );
  if (!ctx.deps.db)
    return errorResponse(
      ctx.msg.request_id,
      ctx.msg.type,
      "unsupported_request",
      unsupportedMessage ?? `${ctx.msg.type} not supported`,
    );
  return {
    ...ctx,
    db: ctx.deps.db,
    workboardService: createGatewayWorkboardService({
      db: ctx.deps.db,
      redactionEngine: ctx.deps.redactionEngine,
      approvalDal: ctx.deps.approvalDal,
      policyService: ctx.deps.policyService,
      protocolDeps: ctx.deps,
    }),
  };
}

export function parseRequest<T>(
  schema: RequestSchema<T>,
  msg: ProtocolRequestEnvelope,
): { data: T } | { response: WsResponseEnvelope } {
  const parsed = schema.safeParse(msg);
  return parsed.success
    ? { data: parsed.data }
    : {
        response: errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
          issues: parsed.error.issues,
        }),
      };
}

export function okResult(msg: ProtocolRequestEnvelope, result: unknown): WsResponseEnvelope {
  return { request_id: msg.request_id, type: msg.type, ok: true, result };
}
export function notFound(msg: ProtocolRequestEnvelope, resource: string): WsResponseEnvelope {
  return errorResponse(msg.request_id, msg.type, "not_found", `${resource} not found`);
}
export function broadcastAgentEvent(
  tenantId: string,
  type: string,
  agentId: string,
  payload: Record<string, unknown>,
  deps: ProtocolDeps,
): void {
  broadcastEvent(
    tenantId,
    {
      event_id: crypto.randomUUID(),
      type,
      occurred_at: new Date().toISOString(),
      scope: { kind: "agent", agent_id: agentId },
      payload,
    },
    deps,
    WORKBOARD_WS_AUDIENCE,
  );
}
export function withClientDal(
  action: string,
  handler: (ctx: ScopedHandlerContext) => Promise<WsResponseEnvelope>,
  unsupportedMessage?: string,
): WorkboardHandler {
  return async (ctx) => {
    const access = requireClientWorkboardAccess(ctx, action, unsupportedMessage);
    return "workboardService" in access ? handler(access) : access;
  };
}

export function createHandler<TReq extends { payload: unknown }>(params: {
  action: string;
  unsupportedMessage?: string;
  schema: RequestSchema<TReq>;
  run: (ctx: ScopedHandlerContext, payload: TReq["payload"]) => Promise<WsResponseEnvelope>;
}): WorkboardHandler {
  return withClientDal(
    params.action,
    async (ctx) => {
      const parsed = parseRequest(params.schema, ctx.msg);
      if ("response" in parsed) return parsed.response;
      try {
        return await params.run(ctx, parsed.data.payload);
      } catch (err) {
        return workboardErrorResponse(ctx.msg.request_id, ctx.msg.type, err, ctx.deps);
      }
    },
    params.unsupportedMessage,
  );
}

export function getWorkTransitionEventType(status: string): string {
  return (
    {
      blocked: "work.item.blocked",
      done: "work.item.completed",
      failed: "work.item.failed",
      cancelled: "work.item.cancelled",
    }[status] ?? "work.item.updated"
  );
}

async function buildStateKvScope(
  deps: ProtocolDeps,
  tenantId: string,
  payload: StateKvScopePayload,
  resolveOnly: boolean,
) {
  const resolver = resolveOnly ? resolveExistingWorkScope : ensureWorkScope;
  const { scope } = await resolver({ deps, tenantId, payload });
  return payload.kind === "agent"
    ? ({ kind: "agent", ...scope } as const)
    : ({ kind: "work_item", ...scope, work_item_id: payload.work_item_id } as const);
}

export async function ensureStateKvScope(
  deps: ProtocolDeps,
  tenantId: string,
  payload: StateKvScopePayload,
) {
  return await buildStateKvScope(deps, tenantId, payload, false);
}

export async function resolveExistingStateKvScope(
  deps: ProtocolDeps,
  tenantId: string,
  payload: StateKvScopePayload,
) {
  return await buildStateKvScope(deps, tenantId, payload, true);
}
