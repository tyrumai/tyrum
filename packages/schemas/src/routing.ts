import { z } from "zod";
import { DateTimeSchema } from "./common.js";
import { AgentId, ThreadId } from "./keys.js";

export const TelegramRoutingConfig = z
  .object({
    default_agent_id: AgentId.optional(),
    threads: z.record(ThreadId, AgentId).optional(),
  })
  .strict();
export type TelegramRoutingConfig = z.infer<typeof TelegramRoutingConfig>;

export const RoutingConfig = z
  .object({
    v: z.number().int().min(1).default(1),
    telegram: TelegramRoutingConfig.optional(),
  })
  .strict();
export type RoutingConfig = z.infer<typeof RoutingConfig>;

export const RoutingConfigRevisionNumber = z.number().int().positive();
export type RoutingConfigRevisionNumber = z.infer<typeof RoutingConfigRevisionNumber>;

export const RoutingConfigGetResponse = z
  .object({
    revision: z.number().int().nonnegative(),
    config: RoutingConfig,
    created_at: DateTimeSchema.optional(),
    created_by: z.unknown().optional(),
    reason: z.string().trim().min(1).optional(),
    reverted_from_revision: RoutingConfigRevisionNumber.optional(),
  })
  .strict();
export type RoutingConfigGetResponse = z.infer<typeof RoutingConfigGetResponse>;

export const RoutingConfigUpdateRequest = z
  .object({
    config: RoutingConfig,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type RoutingConfigUpdateRequest = z.infer<typeof RoutingConfigUpdateRequest>;

export const RoutingConfigUpdateResponse = RoutingConfigGetResponse;
export type RoutingConfigUpdateResponse = z.infer<typeof RoutingConfigUpdateResponse>;

export const RoutingConfigRevertRequest = z
  .object({
    revision: RoutingConfigRevisionNumber,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type RoutingConfigRevertRequest = z.infer<typeof RoutingConfigRevertRequest>;

export const RoutingConfigRevertResponse = RoutingConfigGetResponse;
export type RoutingConfigRevertResponse = z.infer<typeof RoutingConfigRevertResponse>;
