import { z } from "zod";
import { AccountId } from "./keys.js";
import { canonicalizeTelegramAllowedUserIds } from "./telegram.js";

export const ChannelType = z.enum(["telegram"]);
export type ChannelType = z.infer<typeof ChannelType>;

export const TelegramChannelConfigView = z
  .object({
    channel: z.literal("telegram"),
    account_key: AccountId,
    bot_token_configured: z.boolean(),
    webhook_secret_configured: z.boolean(),
    allowed_user_ids: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[0-9]+$/),
      )
      .default([])
      .overwrite(canonicalizeTelegramAllowedUserIds),
    pipeline_enabled: z.boolean().default(true),
  })
  .strict();
export type TelegramChannelConfigView = z.infer<typeof TelegramChannelConfigView>;

export const ChannelConfigView = z.discriminatedUnion("channel", [TelegramChannelConfigView]);
export type ChannelConfigView = z.infer<typeof ChannelConfigView>;

export const ChannelConfigListResponse = z
  .object({
    channels: z.array(ChannelConfigView),
  })
  .strict();
export type ChannelConfigListResponse = z.infer<typeof ChannelConfigListResponse>;

export const TelegramChannelConfigCreateRequest = z
  .object({
    channel: z.literal("telegram"),
    account_key: AccountId,
    bot_token: z.string().trim().min(1).optional(),
    webhook_secret: z.string().trim().min(1).optional(),
    allowed_user_ids: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[0-9]+$/),
      )
      .overwrite(canonicalizeTelegramAllowedUserIds)
      .default([]),
    pipeline_enabled: z.boolean().default(true),
  })
  .strict();
export type TelegramChannelConfigCreateRequest = z.infer<typeof TelegramChannelConfigCreateRequest>;

export const ChannelConfigCreateRequest = z.discriminatedUnion("channel", [
  TelegramChannelConfigCreateRequest,
]);
export type ChannelConfigCreateRequest = z.infer<typeof ChannelConfigCreateRequest>;

export const TelegramChannelConfigUpdateRequest = z
  .object({
    bot_token: z.string().trim().min(1).optional(),
    clear_bot_token: z.boolean().optional(),
    webhook_secret: z.string().trim().min(1).optional(),
    clear_webhook_secret: z.boolean().optional(),
    allowed_user_ids: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[0-9]+$/),
      )
      .overwrite(canonicalizeTelegramAllowedUserIds)
      .optional(),
    pipeline_enabled: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.bot_token && value.clear_bot_token) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "bot_token and clear_bot_token cannot be used together",
        path: ["clear_bot_token"],
      });
    }
    if (value.webhook_secret && value.clear_webhook_secret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "webhook_secret and clear_webhook_secret cannot be used together",
        path: ["clear_webhook_secret"],
      });
    }
  });
export type TelegramChannelConfigUpdateRequest = z.infer<typeof TelegramChannelConfigUpdateRequest>;

export const ChannelConfigUpdateResponse = z
  .object({
    config: ChannelConfigView,
  })
  .strict();
export type ChannelConfigUpdateResponse = z.infer<typeof ChannelConfigUpdateResponse>;

export const ChannelConfigCreateResponse = ChannelConfigUpdateResponse;
export type ChannelConfigCreateResponse = z.infer<typeof ChannelConfigCreateResponse>;

export const ChannelConfigDeleteResponse = z
  .object({
    deleted: z.boolean(),
    channel: ChannelType,
    account_key: AccountId,
  })
  .strict();
export type ChannelConfigDeleteResponse = z.infer<typeof ChannelConfigDeleteResponse>;
