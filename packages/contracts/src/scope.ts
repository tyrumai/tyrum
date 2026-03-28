import { z } from "zod";
import {
  AgentId,
  AgentKey,
  NodeId,
  TenantId,
  TenantKey,
  TyrumKey,
  WorkspaceId,
  WorkspaceKey,
} from "./keys.js";
import { TurnId } from "./execution.js";

/**
 * External scope handles.
 *
 * These are stable keys (not UUID PKs) and are the preferred inputs for APIs.
 * Gateways resolve these to `ScopeIds` once per request/tick.
 */
export const ScopeKeys = z
  .object({
    tenant_key: TenantKey.optional(),
    agent_key: AgentKey.optional(),
    workspace_key: WorkspaceKey.optional(),
  })
  .strict();
export type ScopeKeys = z.infer<typeof ScopeKeys>;

/** Internal resolved UUID PKs used for DB writes/joins. */
export const ScopeIds = z
  .object({
    tenant_id: TenantId,
    agent_id: AgentId,
    workspace_id: WorkspaceId,
  })
  .strict();
export type ScopeIds = z.infer<typeof ScopeIds>;

/**
 * WS event routing scope (within a tenant).
 *
 * Tenant isolation is enforced at the storage layer (`outbox.tenant_id`), so
 * this scope is used for additional in-tenant filtering.
 */
export const EventScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z
    .object({
      kind: z.literal("agent"),
      agent_id: AgentId,
    })
    .strict(),
  z
    .object({
      kind: z.literal("conversation"),
      conversation_key: TyrumKey,
    })
    .strict(),
  z
    .object({
      kind: z.literal("turn"),
      turn_id: TurnId,
    })
    .strict(),
  z
    .object({
      kind: z.literal("node"),
      node_id: NodeId,
    })
    .strict(),
  z
    .object({
      kind: z.literal("client"),
      client_id: z.string().trim().min(1),
    })
    .strict(),
]);
export type EventScope = z.infer<typeof EventScope>;
