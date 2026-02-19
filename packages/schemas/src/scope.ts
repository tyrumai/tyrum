import { z } from "zod";
import { AgentId, Lane, NodeId, TyrumKey } from "./keys.js";
import { ExecutionRunId } from "./execution.js";

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
      kind: z.literal("key"),
      key: TyrumKey,
      lane: Lane.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("run"),
      run_id: ExecutionRunId,
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

