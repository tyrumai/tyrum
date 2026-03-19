import { describe, expect, it } from "vitest";
import {
  asStoredTelegramConfig,
  parseStoredChannelConfigOrThrow,
  toChannelConfigView,
} from "../../src/modules/channels/channel-config-model.js";

describe("channel-config-model", () => {
  it("parses and normalizes stored telegram configs", () => {
    const parsed = parseStoredChannelConfigOrThrow({
      connector_key: "telegram",
      account_key: "default",
      config_json: JSON.stringify({
        channel: "telegram",
        account_key: "default",
        agent_key: "default",
        ingress_mode: "polling",
        bot_token: "bot-token",
        webhook_secret: "secret",
        allowed_user_ids: ["123", "123", "456"],
        pipeline_enabled: true,
      }),
    });

    expect(parsed).toMatchObject({
      channel: "telegram",
      account_key: "default",
      allowed_user_ids: ["123", "456"],
    });
    expect(asStoredTelegramConfig(parsed)).toMatchObject({
      channel: "telegram",
      account_key: "default",
    });
    expect(toChannelConfigView(asStoredTelegramConfig(parsed)!)).toMatchObject({
      ingress_mode: "polling",
      bot_token_configured: true,
      webhook_secret_configured: true,
      allowed_user_ids: ["123", "456"],
      pipeline_enabled: true,
      polling_status: "idle",
      polling_last_error_at: null,
      polling_last_error_message: null,
    });
  });

  it("returns undefined when a stored config is not telegram", () => {
    const parsed = parseStoredChannelConfigOrThrow({
      connector_key: "discord",
      account_key: "ops",
      config_json: JSON.stringify({
        channel: "discord",
        account_key: "ops",
        agent_key: "default",
        bot_token: "discord-token",
        allowed_user_ids: ["123"],
        allowed_channels: ["guild:1/channel:2"],
      }),
    });

    expect(asStoredTelegramConfig(parsed)).toBeUndefined();
  });

  it("enforces google chat auth-method requirements", () => {
    expect(() =>
      parseStoredChannelConfigOrThrow({
        connector_key: "googlechat",
        account_key: "ops",
        config_json: JSON.stringify({
          channel: "googlechat",
          account_key: "ops",
          agent_key: "default",
          auth_method: "inline_json",
          audience_type: "app-url",
          audience: "https://example.test/googlechat",
          allowed_users: [],
        }),
      }),
    ).toThrow(/service_account_json is required/);

    const filePathConfig = parseStoredChannelConfigOrThrow({
      connector_key: "googlechat",
      account_key: "ops",
      config_json: JSON.stringify({
        channel: "googlechat",
        account_key: "ops",
        agent_key: "default",
        auth_method: "file_path",
        service_account_file: "/tmp/service-account.json",
        audience_type: "project-number",
        audience: "123456789",
        allowed_users: ["users/123", "alice@example.com", "users/123"],
      }),
    });

    expect(filePathConfig).toMatchObject({
      channel: "googlechat",
      auth_method: "file_path",
      service_account_file: "/tmp/service-account.json",
      allowed_users: ["users/123", "alice@example.com"],
    });
  });

  it("throws a descriptive error for invalid rows", () => {
    expect(() =>
      parseStoredChannelConfigOrThrow({
        connector_key: "telegram",
        account_key: "broken",
        config_json: JSON.stringify({
          channel: "telegram",
          account_key: "broken",
          allowed_user_ids: ["not-a-number"],
          pipeline_enabled: true,
        }),
      }),
    ).toThrow(/failed schema validation/);
  });
});
