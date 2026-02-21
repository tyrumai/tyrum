import { z } from "zod";
import { DateTimeSchema } from "./common.js";
import { NodeId, AgentId } from "./keys.js";
import { ClientCapability } from "./protocol.js";

export const PresenceRole = z.enum(["client", "node"]);
export type PresenceRole = z.infer<typeof PresenceRole>;

export const PresenceEntry = z
  .object({
    client_id: z.string().min(1),
    role: PresenceRole,
    node_id: NodeId.optional(),
    agent_id: AgentId.optional(),
    capabilities: z.array(ClientCapability).default([]),
    connected_at: DateTimeSchema,
    last_seen_at: DateTimeSchema,
    metadata: z.unknown().optional(),
  })
  .strict();
export type PresenceEntry = z.infer<typeof PresenceEntry>;

export const PresenceEventKind = z.enum(["online", "offline", "heartbeat"]);
export type PresenceEventKind = z.infer<typeof PresenceEventKind>;

export const PresenceEvent = z
  .object({
    kind: PresenceEventKind,
    entry: PresenceEntry,
    occurred_at: DateTimeSchema,
  })
  .strict();
export type PresenceEvent = z.infer<typeof PresenceEvent>;
