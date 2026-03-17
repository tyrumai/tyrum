import { vi } from "vitest";

function createChannelRegistry() {
  return [
    {
      channel: "telegram",
      name: "Telegram",
      doc: null,
      supported: true,
      configurable: true,
      intro_title: "Telegram setup",
      intro_lines: ["Telegram accounts need a bot token, a webhook secret, and a target agent."],
      fields: [
        {
          key: "bot_token",
          label: "Bot token",
          description: "Required for Telegram ingress and username resolution.",
          kind: "secret",
          input: "password",
          section: "credentials",
          required: true,
          help_title: "How to get a bot token",
          help_lines: [
            "1. Open Telegram and chat with @BotFather.",
            "2. Run /newbot (or /mybots).",
            "3. Copy the bot token.",
          ],
        },
        {
          key: "webhook_secret",
          label: "Webhook secret",
          description: "Required for Telegram webhook validation.",
          kind: "secret",
          input: "password",
          section: "credentials",
          required: true,
        },
        {
          key: "allowed_user_ids",
          label: "Allowed Telegram users",
          description: "Numeric sender IDs are stored. @username entries are resolved on save.",
          kind: "config",
          input: "textarea",
          section: "access",
          required: false,
          placeholder: "@username, 123456789",
          help_title: "How to find your Telegram user ID",
          help_lines: [
            "Add yourself to the allowlist first.",
            "Message your bot, then inspect getUpdates and read message.from.id.",
          ],
        },
        {
          key: "agent_key",
          label: "Target agent",
          description: "All Telegram messages for this account will go to this agent.",
          kind: "config",
          input: "select",
          section: "delivery",
          required: true,
          option_source: "agents",
        },
        {
          key: "pipeline_enabled",
          label: "Enable channel pipeline",
          description: "Turn off to stop using the Telegram queue for this account.",
          kind: "config",
          input: "boolean",
          section: "advanced",
          required: false,
          default_value: true,
        },
      ],
    },
    {
      channel: "discord",
      name: "Discord",
      doc: null,
      supported: true,
      configurable: true,
      intro_title: "Discord setup",
      intro_lines: [
        "Discord accounts can resolve DM usernames, guild names, and channel labels on save.",
      ],
      fields: [
        {
          key: "bot_token",
          label: "Bot token",
          description: "Required for Discord setup, resolution, and runtime access.",
          kind: "secret",
          input: "password",
          section: "credentials",
          required: true,
        },
        {
          key: "allowed_user_ids",
          label: "Allowed Discord users",
          description: "Canonical user IDs are stored after resolution.",
          kind: "config",
          input: "textarea",
          section: "access",
          required: false,
          placeholder: "@alice, 123456789012345678",
        },
        {
          key: "allowed_channels",
          label: "Allowed Discord guilds or channels",
          description: "Guild/channel labels resolve to canonical IDs on save.",
          kind: "config",
          input: "textarea",
          section: "access",
          required: false,
          placeholder: "My Server/#general",
        },
        {
          key: "agent_key",
          label: "Target agent",
          description: "All Discord messages for this account will go to this agent.",
          kind: "config",
          input: "select",
          section: "delivery",
          required: true,
          option_source: "agents",
        },
      ],
    },
    {
      channel: "googlechat",
      name: "Google Chat",
      doc: null,
      supported: true,
      configurable: true,
      intro_title: "Google Chat setup",
      intro_lines: ["Google Chat apps require a service account plus webhook audience settings."],
      fields: [
        {
          key: "auth_method",
          label: "Auth method",
          description: "Choose inline JSON or a local service-account file path.",
          kind: "config",
          input: "select",
          section: "credentials",
          required: true,
          default_value: "file_path",
          options: [
            { value: "file_path", label: "Service account JSON file" },
            { value: "inline_json", label: "Paste service account JSON" },
          ],
        },
        {
          key: "service_account_file",
          label: "Service account JSON path",
          description: "Local path to the service-account JSON file.",
          kind: "config",
          input: "text",
          section: "credentials",
          required: true,
          placeholder: "/path/to/service-account.json",
          visible_when: { field_key: "auth_method", equals: "file_path" },
        },
        {
          key: "service_account_json",
          label: "Service account JSON",
          description: "Paste the service-account JSON when using inline credentials.",
          kind: "secret",
          input: "textarea",
          section: "credentials",
          required: true,
          visible_when: { field_key: "auth_method", equals: "inline_json" },
        },
        {
          key: "audience_type",
          label: "Webhook audience type",
          description: "Choose the audience verification mode for Google Chat webhooks.",
          kind: "config",
          input: "select",
          section: "credentials",
          required: true,
          default_value: "app-url",
          options: [
            { value: "app-url", label: "App URL" },
            { value: "project-number", label: "Project number" },
          ],
        },
        {
          key: "audience",
          label: "Webhook audience",
          description: "App URL or project number, depending on the selected audience type.",
          kind: "config",
          input: "text",
          section: "credentials",
          required: true,
          placeholder: "https://your.host/googlechat or 1234567890",
        },
        {
          key: "allowed_users",
          label: "Allowed Google Chat users",
          description: "Enter users/<id> or raw email addresses.",
          kind: "config",
          input: "textarea",
          section: "access",
          required: false,
          placeholder: "users/123456789, name@example.com",
        },
        {
          key: "agent_key",
          label: "Target agent",
          description: "All Google Chat messages for this account will go to this agent.",
          kind: "config",
          input: "select",
          section: "delivery",
          required: true,
          option_source: "agents",
        },
      ],
    },
  ];
}

function createConfiguredChannels(testTimestamp: string) {
  return [
    {
      channel: "telegram",
      name: "Telegram",
      doc: null,
      supported: true,
      configurable: true,
      accounts: [
        {
          channel: "telegram",
          account_key: "default",
          config: {
            agent_key: "default",
            allowed_user_ids: ["123"],
            pipeline_enabled: true,
          },
          configured_secret_keys: ["bot_token", "webhook_secret"],
          created_at: testTimestamp,
          updated_at: testTimestamp,
        },
        {
          channel: "telegram",
          account_key: "ops",
          config: {
            agent_key: "agent-b",
            allowed_user_ids: ["555", "777"],
            pipeline_enabled: false,
          },
          configured_secret_keys: ["webhook_secret"],
          created_at: testTimestamp,
          updated_at: testTimestamp,
        },
      ],
    },
  ];
}

function createRoutingConfigFixture(input: {
  testTimestamp: string;
  routingConfigUpdate: ReturnType<typeof vi.fn>;
  routingConfigRevert: ReturnType<typeof vi.fn>;
}) {
  const { routingConfigRevert, routingConfigUpdate, testTimestamp } = input;
  return {
    get: vi.fn(async () => ({
      revision: 1,
      config: {
        v: 1,
        telegram: {
          accounts: {
            default: {
              default_agent_key: "default",
              threads: { "tg-123": "agent-b" },
            },
            ops: {},
          },
        },
      },
    })),
    listRevisions: vi.fn(async () => ({
      revisions: [
        {
          revision: 1,
          config: {
            v: 1,
            telegram: {
              accounts: {
                default: {
                  default_agent_key: "default",
                  threads: { "tg-123": "agent-b" },
                },
                ops: {},
              },
            },
          },
          created_at: testTimestamp,
        },
      ],
    })),
    listObservedTelegramThreads: vi.fn(async () => ({
      threads: [
        {
          channel: "telegram",
          account_key: "default",
          thread_id: "tg-123",
          container_kind: "group",
          session_title: "Support room",
          last_active_at: testTimestamp,
        },
        {
          channel: "telegram",
          account_key: "default",
          thread_id: "tg-456",
          container_kind: "dm",
          session_title: "Direct chat",
          last_active_at: testTimestamp,
        },
        {
          channel: "telegram",
          account_key: "ops",
          thread_id: "tg-123",
          container_kind: "group",
          session_title: "Ops mirror",
          last_active_at: testTimestamp,
        },
      ],
    })),
    listChannelConfigs: vi.fn(async () => ({
      channels: [
        {
          channel: "telegram",
          account_key: "default",
          bot_token_configured: true,
          webhook_secret_configured: true,
          allowed_user_ids: ["123"],
          pipeline_enabled: true,
        },
        {
          channel: "telegram",
          account_key: "ops",
          bot_token_configured: false,
          webhook_secret_configured: true,
          allowed_user_ids: ["555", "777"],
          pipeline_enabled: false,
        },
      ],
    })),
    createChannelConfig: vi.fn(async () => ({
      config: {
        channel: "telegram",
        account_key: "ops",
        bot_token_configured: true,
        webhook_secret_configured: true,
        allowed_user_ids: ["123"],
        pipeline_enabled: true,
      },
    })),
    update: routingConfigUpdate,
    updateChannelConfig: vi.fn(async () => ({
      config: {
        channel: "telegram",
        account_key: "default",
        bot_token_configured: true,
        webhook_secret_configured: true,
        allowed_user_ids: ["123"],
        pipeline_enabled: true,
      },
    })),
    deleteChannelConfig: vi.fn(async () => ({
      deleted: true,
      channel: "telegram",
      account_key: "default",
    })),
    revert: routingConfigRevert,
  };
}

function createChannelConfigFixture(testTimestamp: string) {
  return {
    listRegistry: vi.fn(async () => ({
      status: "ok",
      channels: createChannelRegistry(),
    })),
    listChannels: vi.fn(async () => ({
      status: "ok",
      channels: createConfiguredChannels(testTimestamp),
    })),
    createAccount: vi.fn(async () => ({ status: "ok" }) as unknown),
    updateAccount: vi.fn(async () => ({ status: "ok" }) as unknown),
    deleteAccount: vi.fn(async () => ({ status: "ok", deleted: true }) as unknown),
  };
}

export function createChannelAndRoutingFixtures(input: {
  testTimestamp: string;
  routingConfigUpdate: ReturnType<typeof vi.fn>;
  routingConfigRevert: ReturnType<typeof vi.fn>;
}) {
  return {
    channelConfig: createChannelConfigFixture(input.testTimestamp),
    routingConfig: createRoutingConfigFixture(input),
  };
}
