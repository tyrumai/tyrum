import { describe, expect, it } from "vitest";
import type { ObservedTelegramThread } from "@tyrum/contracts";
import { getSharedIntl } from "../../src/i18n/messages.js";
import { formatDateTime } from "../../src/utils/format-date-time.js";
import type {
  ChannelRoutingConfig,
  TelegramAccountRoutingConfig,
} from "../../src/components/pages/admin-http-channels.shared.js";
import {
  buildRoutingRuleRows,
  buildTelegramThreadKey,
  countRoutingRules,
  describeRule,
  filterRoutingRuleRows,
  formatTimestamp,
  removeRoutingRule,
  upsertRoutingRule,
  type RoutingRuleRow,
} from "../../src/components/pages/admin-http-routing-config.shared.js";

function createAccountsConfig(
  accounts: Record<string, TelegramAccountRoutingConfig>,
): ChannelRoutingConfig {
  return {
    v: 1,
    telegram: {
      accounts,
    },
  };
}

describe("admin-http-routing-config.shared", () => {
  it("builds sorted routing rule rows from configured accounts and observed threads", () => {
    const config = createAccountsConfig({
      beta: {
        default_agent_key: "beta-default",
        threads: {
          "thread-b": "beta-thread-b",
          "thread-a": "beta-thread-a",
        },
      },
      alpha: {
        threads: {
          "thread-1": "alpha-thread-1",
        },
      },
    });
    const observedThreads: ObservedTelegramThread[] = [
      {
        channel: "telegram",
        account_key: "beta",
        thread_id: "thread-a",
        container_kind: "group",
        session_title: "Alpha project room",
        last_active_at: "2026-03-10T10:00:00.000Z",
      },
      {
        channel: "telegram",
        account_key: "beta",
        thread_id: "thread-a",
        container_kind: "dm",
        session_title: "Duplicate metadata should be ignored",
        last_active_at: "2026-03-09T10:00:00.000Z",
      },
      {
        channel: "telegram",
        account_key: "beta",
        thread_id: "thread-b",
        container_kind: "dm",
        session_title: "Support thread",
        last_active_at: "2026-03-11T10:00:00.000Z",
      },
      {
        channel: "telegram",
        account_key: "alpha",
        thread_id: "thread-1",
        container_kind: "dm",
        session_title: "Alpha direct thread",
        last_active_at: "2026-03-08T10:00:00.000Z",
      },
    ];

    const rows = buildRoutingRuleRows(config, observedThreads);

    expect(countRoutingRules(config)).toBe(4);
    expect(buildTelegramThreadKey("beta", "thread-a")).toBe('["beta","thread-a"]');
    expect(rows).toEqual([
      {
        id: "telegram:thread:alpha:thread-1",
        channel: "telegram",
        kind: "thread",
        accountKey: "alpha",
        agentKey: "alpha-thread-1",
        threadId: "thread-1",
        containerKind: "dm",
        sessionTitle: "Alpha direct thread",
        lastActiveAt: "2026-03-08T10:00:00.000Z",
      },
      {
        id: "telegram:default:beta",
        channel: "telegram",
        kind: "default",
        accountKey: "beta",
        agentKey: "beta-default",
      },
      {
        id: "telegram:thread:beta:thread-b",
        channel: "telegram",
        kind: "thread",
        accountKey: "beta",
        agentKey: "beta-thread-b",
        threadId: "thread-b",
        containerKind: "dm",
        sessionTitle: "Support thread",
        lastActiveAt: "2026-03-11T10:00:00.000Z",
      },
      {
        id: "telegram:thread:beta:thread-a",
        channel: "telegram",
        kind: "thread",
        accountKey: "beta",
        agentKey: "beta-thread-a",
        threadId: "thread-a",
        containerKind: "group",
        sessionTitle: "Alpha project room",
        lastActiveAt: "2026-03-10T10:00:00.000Z",
      },
    ]);
  });

  it("filters routing rule rows by free-text matches and returns the original list for blank queries", () => {
    const rows: RoutingRuleRow[] = [
      {
        id: "telegram:default:alpha",
        channel: "telegram",
        kind: "default",
        accountKey: "alpha",
        agentKey: "alpha-default",
      },
      {
        id: "telegram:thread:beta:thread-1",
        channel: "telegram",
        kind: "thread",
        accountKey: "beta",
        agentKey: "beta-helper",
        threadId: "thread-1",
        containerKind: "group",
        sessionTitle: "Support room",
      },
    ];

    expect(filterRoutingRuleRows(rows, "  ")).toBe(rows);
    expect(filterRoutingRuleRows(rows, "all unmatched")).toEqual([rows[0]]);
    expect(filterRoutingRuleRows(rows, "support")).toEqual([rows[1]]);
    expect(filterRoutingRuleRows(rows, "thread override")).toEqual([rows[1]]);
    expect(filterRoutingRuleRows(rows, "missing")).toEqual([]);
  });

  it("formats timestamps and rule labels for table display", () => {
    const intl = getSharedIntl("en");
    expect(formatTimestamp(intl, "2026-03-10T10:00:00.000Z")).toBe(
      formatDateTime("2026-03-10T10:00:00.000Z", undefined, intl.locale),
    );
    expect(formatTimestamp(intl)).toBe("Not seen");
    expect(
      describeRule({
        id: "telegram:default:ops",
        channel: "telegram",
        kind: "default",
        accountKey: "ops",
        agentKey: "agent-a",
      }),
    ).toBe("All unmatched Telegram chats on ops");
    expect(
      describeRule({
        id: "telegram:thread:ops:thread-1",
        channel: "telegram",
        kind: "thread",
        accountKey: "ops",
        agentKey: "agent-a",
        threadId: "thread-1",
        sessionTitle: "Ops room",
      }),
    ).toBe("Ops room");
  });

  it("upserts routing rules across accounts and preserves legacy default-account config", () => {
    const legacyConfig: ChannelRoutingConfig = {
      v: 1,
      telegram: {
        default_agent_key: "legacy-default",
        threads: {
          "legacy-thread": "legacy-agent",
        },
      },
    };

    const created = upsertRoutingRule(legacyConfig, {
      kind: "thread",
      accountKey: "ops",
      agentKey: "ops-agent",
      threadId: "ops-thread",
    });

    expect(created).toEqual({
      v: 1,
      telegram: {
        accounts: {
          default: {
            default_agent_key: "legacy-default",
            threads: {
              "legacy-thread": "legacy-agent",
            },
          },
          ops: {
            threads: {
              "ops-thread": "ops-agent",
            },
          },
        },
      },
    });
  });

  it("moves existing thread rules and removes empty accounts during upsert and delete flows", () => {
    const config = createAccountsConfig({
      alpha: {
        default_agent_key: "alpha-default",
        threads: {
          "thread-1": "alpha-thread-1",
        },
      },
      beta: {
        threads: {
          "thread-2": "beta-thread-2",
        },
      },
    });

    const moved = upsertRoutingRule(
      config,
      {
        kind: "default",
        accountKey: "beta",
        agentKey: "beta-default",
        threadId: "",
      },
      {
        id: "telegram:thread:alpha:thread-1",
        channel: "telegram",
        kind: "thread",
        accountKey: "alpha",
        agentKey: "alpha-thread-1",
        threadId: "thread-1",
      },
    );

    expect(moved).toEqual({
      v: 1,
      telegram: {
        accounts: {
          alpha: {
            default_agent_key: "alpha-default",
          },
          beta: {
            default_agent_key: "beta-default",
            threads: {
              "thread-2": "beta-thread-2",
            },
          },
        },
      },
    });

    const removed = removeRoutingRule(moved, {
      id: "telegram:default:alpha",
      channel: "telegram",
      kind: "default",
      accountKey: "alpha",
      agentKey: "alpha-default",
    });

    expect(removed).toEqual({
      v: 1,
      telegram: {
        accounts: {
          beta: {
            default_agent_key: "beta-default",
            threads: {
              "thread-2": "beta-thread-2",
            },
          },
        },
      },
    });

    expect(
      removeRoutingRule(removed, {
        id: "telegram:thread:missing:thread-9",
        channel: "telegram",
        kind: "thread",
        accountKey: "missing",
        agentKey: "missing-agent",
        threadId: "thread-9",
      }),
    ).toBe(removed);

    expect(
      removeRoutingRule(removed, {
        id: "telegram:default:beta",
        channel: "telegram",
        kind: "default",
        accountKey: "beta",
        agentKey: "beta-default",
      }),
    ).toEqual({
      v: 1,
      telegram: {
        accounts: {
          beta: {
            threads: {
              "thread-2": "beta-thread-2",
            },
          },
        },
      },
    });
  });
});
