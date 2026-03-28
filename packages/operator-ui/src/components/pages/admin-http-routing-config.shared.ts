import type { IntlShape } from "react-intl";
import type { ObservedTelegramThread } from "@tyrum/contracts";
import { formatDateTimeString } from "../../i18n-helpers.js";
import type {
  ChannelRoutingConfig,
  TelegramAccountRoutingConfig,
} from "./admin-http-channels.shared.js";
import { getTelegramAccounts } from "./admin-http-channels.shared.js";

export type RoutingRuleKind = "default" | "thread";

export type RoutingRuleRow = {
  id: string;
  channel: "telegram";
  kind: RoutingRuleKind;
  accountKey: string;
  agentKey: string;
  threadId?: string;
  containerKind?: ObservedTelegramThread["container_kind"];
  conversationTitle?: string;
  lastActiveAt?: string;
};

export type RoutingRuleDraft = {
  kind: RoutingRuleKind;
  accountKey: string;
  agentKey: string;
  threadId: string;
};

function compareDatesDesc(left?: string, right?: string): number {
  const leftMs = left ? Date.parse(left) : 0;
  const rightMs = right ? Date.parse(right) : 0;
  return rightMs - leftMs;
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

export function buildTelegramThreadKey(accountKey: string, threadId: string): string {
  return JSON.stringify([accountKey, threadId]);
}

export function formatTimestamp(intl: IntlShape, value?: string): string {
  return formatDateTimeString(intl, value, "Not seen");
}

export function describeRule(row: RoutingRuleRow): string {
  if (row.kind === "default") {
    return `All unmatched Telegram chats on ${row.accountKey}`;
  }
  return row.conversationTitle ?? row.threadId ?? "Unknown thread";
}

function normalizeTelegramAccountConfig(
  value: TelegramAccountRoutingConfig | undefined,
): TelegramAccountRoutingConfig | undefined {
  if (!value) return undefined;
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

function normalizeTelegramAccounts(
  accounts: Record<string, TelegramAccountRoutingConfig>,
): Record<string, TelegramAccountRoutingConfig> | undefined {
  const normalizedAccounts = Object.fromEntries(
    Object.entries(accounts)
      .map(([accountKey, accountConfig]) => [
        accountKey,
        normalizeTelegramAccountConfig(accountConfig),
      ])
      .filter((entry): entry is [string, TelegramAccountRoutingConfig] => Boolean(entry[1])),
  );
  return Object.keys(normalizedAccounts).length > 0 ? normalizedAccounts : undefined;
}

export function countRoutingRules(config: ChannelRoutingConfig): number {
  const telegramAccounts = getTelegramAccounts(config);
  let total = 0;
  for (const accountConfig of Object.values(telegramAccounts)) {
    if (accountConfig.default_agent_key) {
      total += 1;
    }
    total += Object.keys(accountConfig.threads ?? {}).length;
  }
  return total;
}

export function buildRoutingRuleRows(
  config: ChannelRoutingConfig,
  observedThreads: ObservedTelegramThread[],
): RoutingRuleRow[] {
  const rows: RoutingRuleRow[] = [];
  const threadLookup = new Map<string, ObservedTelegramThread>();
  for (const thread of observedThreads) {
    const threadKey = buildTelegramThreadKey(thread.account_key, thread.thread_id);
    if (!threadLookup.has(threadKey)) {
      threadLookup.set(threadKey, thread);
    }
  }

  const accountEntries = Object.entries(getTelegramAccounts(config)).toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [accountKey, accountConfig] of accountEntries) {
    if (accountConfig.default_agent_key) {
      rows.push({
        id: `telegram:default:${accountKey}`,
        channel: "telegram",
        kind: "default",
        accountKey,
        agentKey: accountConfig.default_agent_key,
      });
    }

    const threadEntries = Object.entries(accountConfig.threads ?? {}).map(
      ([threadId, agentKey]) => {
        const observed = threadLookup.get(buildTelegramThreadKey(accountKey, threadId));
        return {
          id: `telegram:thread:${accountKey}:${threadId}`,
          channel: "telegram" as const,
          kind: "thread" as const,
          accountKey,
          agentKey,
          threadId,
          containerKind: observed?.container_kind,
          conversationTitle: observed?.conversation_title,
          lastActiveAt: observed?.last_active_at,
        };
      },
    );
    threadEntries.sort((left, right) => {
      const lastActiveOrder = compareDatesDesc(left.lastActiveAt, right.lastActiveAt);
      if (lastActiveOrder !== 0) return lastActiveOrder;
      const accountOrder = left.accountKey.localeCompare(right.accountKey);
      if (accountOrder !== 0) return accountOrder;
      return (left.threadId ?? "").localeCompare(right.threadId ?? "");
    });
    rows.push(...threadEntries);
  }

  return rows;
}

export function filterRoutingRuleRows(rows: RoutingRuleRow[], query: string): RoutingRuleRow[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return rows;
  return rows.filter((row) =>
    [
      row.channel,
      row.kind,
      row.accountKey,
      row.agentKey,
      row.threadId,
      row.containerKind,
      row.conversationTitle,
      row.kind === "default" ? "all unmatched telegram chats" : "thread override",
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalized)),
  );
}

export function upsertRoutingRule(
  config: ChannelRoutingConfig,
  draft: RoutingRuleDraft,
  existing?: RoutingRuleRow | null,
): ChannelRoutingConfig {
  const nextAccounts = Object.fromEntries(
    Object.entries(getTelegramAccounts(config)).map(([accountKey, accountConfig]) => [
      accountKey,
      {
        ...(accountConfig.default_agent_key
          ? { default_agent_key: accountConfig.default_agent_key }
          : {}),
        ...(accountConfig.threads ? { threads: { ...accountConfig.threads } } : {}),
      },
    ]),
  );

  if (existing) {
    const existingAccount = nextAccounts[existing.accountKey];
    if (existingAccount) {
      if (existing.kind === "default") {
        delete existingAccount.default_agent_key;
      } else if (existing.threadId) {
        delete existingAccount.threads?.[existing.threadId];
      }
      const normalizedAccount = normalizeTelegramAccountConfig(existingAccount);
      if (normalizedAccount) {
        nextAccounts[existing.accountKey] = normalizedAccount;
      } else {
        delete nextAccounts[existing.accountKey];
      }
    }
  }

  const targetAccount = {
    ...(nextAccounts[draft.accountKey]?.default_agent_key
      ? { default_agent_key: nextAccounts[draft.accountKey]?.default_agent_key }
      : {}),
    ...(nextAccounts[draft.accountKey]?.threads
      ? { threads: { ...nextAccounts[draft.accountKey]?.threads } }
      : {}),
  };

  if (draft.kind === "default") {
    targetAccount.default_agent_key = draft.agentKey;
  } else {
    targetAccount.threads = {
      ...targetAccount.threads,
      [draft.threadId]: draft.agentKey,
    };
  }

  nextAccounts[draft.accountKey] = targetAccount;
  const normalizedAccounts = normalizeTelegramAccounts(nextAccounts);
  return normalizedAccounts
    ? {
        v: config.v,
        telegram: {
          accounts: normalizedAccounts,
        },
      }
    : { v: config.v };
}

export function removeRoutingRule(
  config: ChannelRoutingConfig,
  row: RoutingRuleRow,
): ChannelRoutingConfig {
  const nextAccounts = Object.fromEntries(
    Object.entries(getTelegramAccounts(config)).map(([accountKey, accountConfig]) => [
      accountKey,
      {
        ...(accountConfig.default_agent_key
          ? { default_agent_key: accountConfig.default_agent_key }
          : {}),
        ...(accountConfig.threads ? { threads: { ...accountConfig.threads } } : {}),
      },
    ]),
  );
  const accountConfig = nextAccounts[row.accountKey];

  if (!accountConfig) {
    return config;
  }

  if (row.kind === "default") {
    delete accountConfig.default_agent_key;
  } else if (row.threadId) {
    delete accountConfig.threads?.[row.threadId];
  }

  const normalizedAccount = normalizeTelegramAccountConfig(accountConfig);
  if (normalizedAccount) {
    nextAccounts[row.accountKey] = normalizedAccount;
  } else {
    delete nextAccounts[row.accountKey];
  }

  const normalizedAccounts = normalizeTelegramAccounts(nextAccounts);
  return normalizedAccounts
    ? {
        v: config.v,
        telegram: {
          accounts: normalizedAccounts,
        },
      }
    : { v: config.v };
}
