import { describe, expect, it } from "vitest";
import {
  asChannelRoutingApi,
  buildTelegramChannelCreateInput,
  buildTelegramChannelUpdateInput,
  formatAllowedUserIds,
  getTelegramAccounts,
  isTelegramChannelConfig,
  parseAllowedUserIds,
  removeConfig,
  replaceConfig,
  sameStringList,
  sortChannelConfigs,
} from "../../src/components/pages/admin-http-channels.shared.js";

describe("legacy channel helper compatibility", () => {
  it("parses and formats allowlisted Telegram user IDs", () => {
    expect(parseAllowedUserIds("123\n456,123 abc")).toEqual({
      ids: ["123", "456"],
      invalid: ["abc"],
    });
    expect(formatAllowedUserIds(["123", "456"])).toBe("123\n456");
    expect(sameStringList(["123"], ["123"])).toBe(true);
    expect(sameStringList(["123"], ["456"])).toBe(false);
  });

  it("builds create and update payloads from trimmed Telegram form values", () => {
    expect(
      buildTelegramChannelCreateInput({
        accountKey: " alerts ",
        ingressMode: "polling",
        botTokenRaw: " bot-token ",
        webhookSecretRaw: " webhook-secret ",
        allowedUserIds: ["123"],
        pipelineEnabled: true,
      }),
    ).toEqual({
      channel: "telegram",
      account_key: "alerts",
      ingress_mode: "polling",
      bot_token: "bot-token",
      allowed_user_ids: ["123"],
      pipeline_enabled: true,
    });

    expect(
      buildTelegramChannelUpdateInput({
        ingressMode: "webhook",
        botTokenRaw: " refreshed-token ",
        clearBotToken: false,
        webhookSecretRaw: " ",
        clearWebhookSecret: true,
        allowedUserIds: ["456"],
        pipelineEnabled: false,
      }),
    ).toEqual({
      ingress_mode: "webhook",
      bot_token: "refreshed-token",
      clear_webhook_secret: true,
      allowed_user_ids: ["456"],
      pipeline_enabled: false,
    });

    expect(
      buildTelegramChannelUpdateInput({
        ingressMode: "polling",
        botTokenRaw: " ",
        clearBotToken: false,
        webhookSecretRaw: " ",
        clearWebhookSecret: true,
        allowedUserIds: [],
        pipelineEnabled: true,
      }),
    ).toEqual({
      ingress_mode: "polling",
      allowed_user_ids: [],
      pipeline_enabled: true,
    });
  });

  it("reads Telegram routing accounts from explicit and legacy routing shapes", () => {
    expect(
      getTelegramAccounts({
        v: 1,
        telegram: {
          accounts: {
            alerts: {
              default_agent_key: "default",
              threads: {
                "chat:1": "agent-b",
              },
            },
          },
        },
      }),
    ).toEqual({
      alerts: {
        default_agent_key: "default",
        threads: {
          "chat:1": "agent-b",
        },
      },
    });

    expect(
      getTelegramAccounts({
        v: 1,
        telegram: {
          default_agent_key: "default",
          threads: {
            "chat:2": "agent-c",
          },
        },
      }),
    ).toEqual({
      default: {
        default_agent_key: "default",
        threads: {
          "chat:2": "agent-c",
        },
      },
    });

    expect(getTelegramAccounts({ v: 1 })).toEqual({});
  });

  it("sorts, replaces, and removes Telegram configs while preserving channel compatibility helpers", () => {
    const alpha = {
      channel: "telegram" as const,
      account_key: "alpha",
      ingress_mode: "polling" as const,
      bot_token_configured: true,
      webhook_secret_configured: true,
      allowed_user_ids: ["123"],
      pipeline_enabled: true,
      polling_status: "idle" as const,
      polling_last_error_at: null,
      polling_last_error_message: null,
    };
    const beta = {
      channel: "telegram" as const,
      account_key: "beta",
      ingress_mode: "webhook" as const,
      bot_token_configured: false,
      webhook_secret_configured: true,
      allowed_user_ids: [],
      pipeline_enabled: false,
      polling_status: "error" as const,
      polling_last_error_at: "2026-03-19T00:00:00.000Z",
      polling_last_error_message: "poll failed",
    };

    expect(isTelegramChannelConfig(alpha)).toBe(true);
    expect(
      isTelegramChannelConfig({
        channel: "discord",
      }),
    ).toBe(false);

    expect(sortChannelConfigs([beta, alpha])).toEqual([alpha, beta]);
    expect(replaceConfig([alpha], beta)).toEqual([alpha, beta]);
    expect(
      replaceConfig([alpha, beta], {
        ...beta,
        allowed_user_ids: ["999"],
      }),
    ).toEqual([alpha, { ...beta, allowed_user_ids: ["999"] }]);
    expect(removeConfig([alpha, beta], "alpha")).toEqual([beta]);

    const api = {} as Parameters<typeof asChannelRoutingApi>[0];
    expect(asChannelRoutingApi(api)).toBe(api);
    expect(asChannelRoutingApi(undefined)).toBeNull();
  });
});
