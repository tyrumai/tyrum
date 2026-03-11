import type {
  ObservedTelegramThread,
  RoutingConfig,
  RoutingConfigRevisionSummary,
} from "@tyrum/schemas";

export type RoutingRuleKind = "default" | "thread";

export type RoutingRuleRow = {
  id: string;
  channel: "telegram";
  kind: RoutingRuleKind;
  agentKey: string;
  threadId?: string;
  containerKind?: ObservedTelegramThread["container_kind"];
  accountKey?: string;
  sessionTitle?: string;
  lastActiveAt?: string;
};

export type RoutingRuleDraft = {
  kind: RoutingRuleKind;
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

export function countRoutingRules(config: RoutingConfig): number {
  const threadCount = Object.keys(config.telegram?.threads ?? {}).length;
  return (config.telegram?.default_agent_key ? 1 : 0) + threadCount;
}

export function buildRoutingRuleRows(
  config: RoutingConfig,
  observedThreads: ObservedTelegramThread[],
): RoutingRuleRow[] {
  const rows: RoutingRuleRow[] = [];
  const threadLookup = new Map<string, ObservedTelegramThread>();
  for (const thread of observedThreads) {
    if (!threadLookup.has(thread.thread_id)) {
      threadLookup.set(thread.thread_id, thread);
    }
  }

  const defaultAgentKey = config.telegram?.default_agent_key;
  if (defaultAgentKey) {
    rows.push({
      id: "telegram:default",
      channel: "telegram",
      kind: "default",
      agentKey: defaultAgentKey,
    });
  }

  const threadEntries = Object.entries(config.telegram?.threads ?? {}).map(
    ([threadId, agentKey]) => {
      const observed = threadLookup.get(threadId);
      return {
        id: `telegram:thread:${threadId}`,
        channel: "telegram" as const,
        kind: "thread" as const,
        agentKey,
        threadId,
        containerKind: observed?.container_kind,
        accountKey: observed?.account_key,
        sessionTitle: observed?.session_title,
        lastActiveAt: observed?.last_active_at,
      };
    },
  );
  threadEntries.sort((left, right) => {
    const lastActiveOrder = compareDatesDesc(left.lastActiveAt, right.lastActiveAt);
    if (lastActiveOrder !== 0) return lastActiveOrder;
    return (left.threadId ?? "").localeCompare(right.threadId ?? "");
  });

  rows.push(...threadEntries);
  return rows;
}

export function filterRoutingRuleRows(rows: RoutingRuleRow[], query: string): RoutingRuleRow[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return rows;
  return rows.filter((row) =>
    [
      row.channel,
      row.kind,
      row.agentKey,
      row.threadId,
      row.containerKind,
      row.accountKey,
      row.sessionTitle,
      row.kind === "default" ? "all unmatched telegram chats" : "thread override",
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalized)),
  );
}

export function upsertRoutingRule(
  config: RoutingConfig,
  draft: RoutingRuleDraft,
  existing?: RoutingRuleRow | null,
): RoutingConfig {
  const nextThreads = { ...config.telegram?.threads };
  const nextTelegram = { ...config.telegram };

  if (existing?.kind === "default") {
    delete nextTelegram.default_agent_key;
  }
  if (existing?.kind === "thread" && existing.threadId) {
    delete nextThreads[existing.threadId];
  }

  if (draft.kind === "default") {
    nextTelegram.default_agent_key = draft.agentKey;
  } else {
    nextThreads[draft.threadId] = draft.agentKey;
  }

  if (Object.keys(nextThreads).length > 0) {
    nextTelegram.threads = nextThreads;
  } else {
    delete nextTelegram.threads;
  }

  if (!nextTelegram.default_agent_key && !nextTelegram.threads) {
    return { v: config.v };
  }

  return {
    v: config.v,
    telegram: nextTelegram,
  };
}

export function removeRoutingRule(config: RoutingConfig, row: RoutingRuleRow): RoutingConfig {
  const nextThreads = { ...config.telegram?.threads };
  const nextTelegram = { ...config.telegram };

  if (row.kind === "default") {
    delete nextTelegram.default_agent_key;
  }
  if (row.kind === "thread" && row.threadId) {
    delete nextThreads[row.threadId];
  }

  if (Object.keys(nextThreads).length > 0) {
    nextTelegram.threads = nextThreads;
  } else {
    delete nextTelegram.threads;
  }

  if (!nextTelegram.default_agent_key && !nextTelegram.threads) {
    return { v: config.v };
  }

  return {
    v: config.v,
    telegram: nextTelegram,
  };
}

export function findLatestRevision(
  revisions: RoutingConfigRevisionSummary[],
  revision: number,
): RoutingConfigRevisionSummary | undefined {
  return revisions.find((candidate) => candidate.revision === revision);
}
