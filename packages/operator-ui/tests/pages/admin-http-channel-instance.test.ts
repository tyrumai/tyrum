// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TelegramChannelCard } from "../../src/components/pages/admin-http-channel-instance.js";
import type { TelegramChannelConfig } from "../../src/components/pages/admin-http-channels.shared.js";

function createTelegramConfig(
  overrides: Partial<TelegramChannelConfig> = {},
): TelegramChannelConfig {
  return {
    channel: "telegram",
    account_key: "default",
    ingress_mode: "polling",
    bot_token_configured: true,
    webhook_secret_configured: false,
    allowed_user_ids: [],
    pipeline_enabled: true,
    polling_status: "idle",
    polling_last_error_at: null,
    polling_last_error_message: null,
    ...overrides,
  };
}

describe("TelegramChannelCard", () => {
  it("renders webhook fields on the first paint for webhook accounts", () => {
    const markup = renderToStaticMarkup(
      React.createElement(TelegramChannelCard, {
        config: createTelegramConfig({
          ingress_mode: "webhook",
          webhook_secret_configured: true,
          allowed_user_ids: ["123"],
          pipeline_enabled: false,
        }),
        expanded: true,
        onToggle: () => {},
        onUpdated: () => {},
        onDeleted: () => {},
        onChannelConfigsChanged: () => {},
        mutationApi: {
          updateChannelConfig: vi.fn(),
          deleteChannelConfig: vi.fn(),
        } as never,
        canMutate: true,
        requestEnter: () => {},
      }),
    );

    expect(markup).toContain("channels-instance-default-webhook-secret");
    expect(markup).toContain("channels-instance-default-allowed-user-ids");
  });
});
