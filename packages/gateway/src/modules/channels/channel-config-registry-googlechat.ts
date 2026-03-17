import { ChannelRegistryEntry } from "@tyrum/schemas";
import type {
  GoogleChatAudienceType,
  GoogleChatAuthMethod,
  StoredGoogleChatChannelConfig,
} from "./channel-config-dal.js";
import {
  type ChannelRegistrySpec,
  configuredSecretKeysForConfig,
  field,
  fieldError,
  parseStringList,
  readEnumValue,
  readOptionalString,
  readRequiredSecret,
  readRequiredString,
  resolveSecretUpdate,
  toConfiguredChannelAccount,
  unique,
} from "./channel-config-registry-shared.js";

const GOOGLE_CHAT_INTRO_LINES = [
  "Google Chat apps require a service account plus webhook audience settings.",
  "Choose whether Tyrum should store inline JSON or a local JSON file path.",
];

function normalizeGoogleChatAllowedUsers(values: string[]): string[] {
  return unique(
    values.map((value) => {
      const trimmed = value.trim();
      if (/^users\/.+$/i.test(trimmed)) {
        return `users/${trimmed.slice("users/".length).trim()}`;
      }
      return trimmed.toLowerCase();
    }),
  );
}

export const googleChatSpec: ChannelRegistrySpec<StoredGoogleChatChannelConfig> = {
  entry: ChannelRegistryEntry.parse({
    channel: "googlechat",
    name: "Google Chat",
    doc: null,
    supported: true,
    configurable: true,
    intro_title: "Google Chat setup",
    intro_lines: GOOGLE_CHAT_INTRO_LINES,
    fields: [
      field({
        key: "auth_method",
        label: "Auth method",
        description:
          "Choose whether Tyrum stores inline JSON or a local service-account file path.",
        kind: "config",
        input: "select",
        section: "credentials",
        required: true,
        default_value: "file_path",
        options: [
          { value: "file_path", label: "Service account JSON file" },
          { value: "inline_json", label: "Paste service account JSON" },
        ],
      }),
      field({
        key: "service_account_file",
        label: "Service account JSON path",
        description: "Local path to the Google Chat service-account JSON file.",
        kind: "config",
        input: "text",
        section: "credentials",
        required: true,
        placeholder: "/path/to/service-account.json",
        visible_when: {
          field_key: "auth_method",
          equals: "file_path",
        },
      }),
      field({
        key: "service_account_json",
        label: "Service account JSON",
        description: "Paste the service-account JSON when using inline credentials.",
        kind: "secret",
        input: "textarea",
        section: "credentials",
        required: true,
        visible_when: {
          field_key: "auth_method",
          equals: "inline_json",
        },
      }),
      field({
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
      }),
      field({
        key: "audience",
        label: "Webhook audience",
        description: "App URL or project number, depending on the selected audience type.",
        kind: "config",
        input: "text",
        section: "credentials",
        required: true,
        placeholder: "https://your.host/googlechat or 1234567890",
      }),
      field({
        key: "allowed_users",
        label: "Allowed Google Chat users",
        description: "Enter users/<id> or raw email addresses, separated by newlines or commas.",
        kind: "config",
        input: "textarea",
        section: "access",
        required: false,
        placeholder: "users/123456789, name@example.com",
      }),
      field({
        key: "agent_key",
        label: "Target agent",
        description: "All Google Chat messages for this account will go to this agent.",
        kind: "config",
        input: "select",
        section: "delivery",
        required: true,
        option_source: "agents",
      }),
    ],
  }),
  async create(input) {
    const authMethod = readEnumValue(input.config, "auth_method", "Auth method", [
      "inline_json",
      "file_path",
    ] as const) as GoogleChatAuthMethod;
    return {
      channel: "googlechat",
      account_key: input.accountKey,
      agent_key: readRequiredString(input.config, "agent_key", "Target agent"),
      auth_method: authMethod,
      ...(authMethod === "inline_json"
        ? {
            service_account_json: readRequiredSecret(
              input.secrets,
              "service_account_json",
              "Service account JSON",
            ),
          }
        : {
            service_account_file: readRequiredString(
              input.config,
              "service_account_file",
              "Service account JSON path",
            ),
          }),
      audience_type: readEnumValue(input.config, "audience_type", "Webhook audience type", [
        "app-url",
        "project-number",
      ] as const) as GoogleChatAudienceType,
      audience: readRequiredString(input.config, "audience", "Webhook audience"),
      allowed_users: normalizeGoogleChatAllowedUsers(
        parseStringList(input.config["allowed_users"]),
      ),
    };
  },
  async update(input) {
    const authMethod = readEnumValue(input.config, "auth_method", "Auth method", [
      "inline_json",
      "file_path",
    ] as const) as GoogleChatAuthMethod;
    const next: StoredGoogleChatChannelConfig = {
      channel: "googlechat",
      account_key: input.current.account_key,
      agent_key: readRequiredString(input.config, "agent_key", "Target agent"),
      auth_method: authMethod,
      audience_type: readEnumValue(input.config, "audience_type", "Webhook audience type", [
        "app-url",
        "project-number",
      ] as const) as GoogleChatAudienceType,
      audience: readRequiredString(input.config, "audience", "Webhook audience"),
      allowed_users: normalizeGoogleChatAllowedUsers(
        parseStringList(input.config["allowed_users"]),
      ),
      ...(authMethod === "inline_json"
        ? {
            service_account_json: resolveSecretUpdate({
              key: "service_account_json",
              label: "Service account JSON",
              current: input.current.service_account_json,
              secrets: input.secrets,
              clearSecretKeys: input.clearSecretKeys,
              required: true,
            }),
          }
        : {
            service_account_file:
              readOptionalString(input.config, "service_account_file") ??
              input.current.service_account_file ??
              (() => {
                throw fieldError("service_account_file", "Service account JSON path is required");
              })(),
          }),
    };
    return next;
  },
  toConfiguredAccount(input) {
    return toConfiguredChannelAccount({
      channel: "googlechat",
      accountKey: input.config.account_key,
      config: {
        agent_key: input.config.agent_key,
        auth_method: input.config.auth_method,
        ...(input.config.service_account_file
          ? { service_account_file: input.config.service_account_file }
          : {}),
        audience_type: input.config.audience_type,
        audience: input.config.audience,
        allowed_users: input.config.allowed_users,
      },
      configuredSecretKeys: configuredSecretKeysForConfig(input.config),
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });
  },
};
