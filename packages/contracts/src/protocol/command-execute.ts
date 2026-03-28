import { z } from "zod";
import { AgentKey, TyrumKey } from "../keys.js";
import { WsRequestEnvelope } from "./envelopes.js";

export const WsCommandExecutePayload = z
  .object({
    command: z.string().trim().min(1),
    agent_id: AgentKey.optional(),
    channel: z.string().trim().min(1).optional(),
    thread_id: z.string().trim().min(1).optional(),
    conversation_key: TyrumKey.optional(),
  })
  .strict();
export type WsCommandExecutePayload = z.infer<typeof WsCommandExecutePayload>;

export const WsCommandExecuteRequest = WsRequestEnvelope.extend({
  type: z.literal("command.execute"),
  payload: WsCommandExecutePayload,
});
export type WsCommandExecuteRequest = z.infer<typeof WsCommandExecuteRequest>;

export const WsCommandExecuteResult = z
  .object({
    output: z.string(),
    data: z.unknown().optional(),
  })
  .strict();
export type WsCommandExecuteResult = z.infer<typeof WsCommandExecuteResult>;
