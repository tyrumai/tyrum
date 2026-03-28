import { z } from "zod";
import { DateTimeSchema } from "./common.js";
import { AgentKey, ThreadId, AccountId } from "./keys.js";
import { NormalizedContainerKind } from "./message.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const LegacyTelegramRoutingConfig = z
  .object({
    default_agent_key: AgentKey.optional(),
    threads: z.record(ThreadId, AgentKey).optional(),
  })
  .strict();

export const TelegramAccountRoutingConfig = z
  .object({
    default_agent_key: AgentKey.optional(),
    threads: z.record(ThreadId, AgentKey).optional(),
  })
  .strict();
export type TelegramAccountRoutingConfig = z.infer<typeof TelegramAccountRoutingConfig>;

function normalizeTelegramAccountRoutingConfig(
  value: TelegramAccountRoutingConfig,
): TelegramAccountRoutingConfig | undefined {
  const threads =
    value.threads && Object.keys(value.threads).length > 0 ? value.threads : undefined;
  if (!value.default_agent_key && !threads) {
    return undefined;
  }
  return {
    ...(value.default_agent_key ? { default_agent_key: value.default_agent_key } : {}),
    ...(threads ? { threads } : {}),
  };
}

function normalizeTelegramRoutingConfigInput(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  if (isRecord(value["accounts"])) {
    const accounts: Record<string, unknown> = {};
    for (const [accountKey, accountValue] of Object.entries(value["accounts"])) {
      accounts[accountKey] = accountValue;
    }
    return { accounts };
  }

  const legacyCandidate = LegacyTelegramRoutingConfig.safeParse(value);
  if (!legacyCandidate.success) {
    return value;
  }

  return {
    accounts: {
      default: legacyCandidate.data,
    },
  };
}

const TelegramRoutingConfigShape = z
  .object({
    accounts: z.record(AccountId, TelegramAccountRoutingConfig).optional(),
  })
  .strict();

export const TelegramRoutingConfig = z
  .preprocess(normalizeTelegramRoutingConfigInput, TelegramRoutingConfigShape)
  .transform((value) => {
    const normalizedAccounts = Object.fromEntries(
      Object.entries(value.accounts ?? {})
        .map(([accountKey, accountConfig]) => [
          accountKey,
          normalizeTelegramAccountRoutingConfig(accountConfig),
        ])
        .filter(([, accountConfig]) => accountConfig !== undefined),
    );
    return Object.keys(normalizedAccounts).length > 0
      ? { accounts: normalizedAccounts }
      : { accounts: undefined };
  });
export type TelegramRoutingConfig = z.infer<typeof TelegramRoutingConfig>;

export const RoutingConfig = z
  .object({
    v: z.number().int().min(1).default(1),
    telegram: TelegramRoutingConfig.optional(),
  })
  .strict()
  .transform((value) => ({
    v: value.v,
    ...(value.telegram?.accounts && Object.keys(value.telegram.accounts).length > 0
      ? { telegram: value.telegram }
      : {}),
  }));
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

export const RoutingConfigRevisionSummary = z
  .object({
    revision: RoutingConfigRevisionNumber,
    config: RoutingConfig,
    created_at: DateTimeSchema,
    created_by: z.unknown().optional(),
    reason: z.string().trim().min(1).optional(),
    reverted_from_revision: RoutingConfigRevisionNumber.optional(),
  })
  .strict();
export type RoutingConfigRevisionSummary = z.infer<typeof RoutingConfigRevisionSummary>;

export const RoutingConfigRevisionListResponse = z
  .object({
    revisions: z.array(RoutingConfigRevisionSummary),
  })
  .strict();
export type RoutingConfigRevisionListResponse = z.infer<typeof RoutingConfigRevisionListResponse>;

export const ObservedTelegramThread = z
  .object({
    channel: z.literal("telegram"),
    account_key: AccountId,
    thread_id: ThreadId,
    container_kind: NormalizedContainerKind,
    conversation_title: z.string().trim().min(1).optional(),
    last_active_at: DateTimeSchema.optional(),
  })
  .strict();
export type ObservedTelegramThread = z.infer<typeof ObservedTelegramThread>;

export const ObservedTelegramThreadListResponse = z
  .object({
    threads: z.array(ObservedTelegramThread),
  })
  .strict();
export type ObservedTelegramThreadListResponse = z.infer<typeof ObservedTelegramThreadListResponse>;
