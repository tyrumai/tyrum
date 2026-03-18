import { TyrumHttpClientError, type AgentListResult } from "@tyrum/client";
import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { Badge } from "../ui/badge.js";
import { useAdminHttpClient } from "./admin-http-shared.js";

export type AdminChannelApi = NonNullable<ReturnType<typeof useAdminHttpClient>["channelConfig"]>;
export type ChannelRegistryEntry = Awaited<
  ReturnType<AdminChannelApi["listRegistry"]>
>["channels"][number];
export type ConfiguredChannelGroup = Awaited<
  ReturnType<AdminChannelApi["listChannels"]>
>["channels"][number];
export type ConfiguredChannelAccount = ConfiguredChannelGroup["accounts"][number];

export type AgentOption = {
  key: string;
  label: string;
};

export type ChannelFormState = {
  channel: string;
  accountKey: string;
  configValues: Record<string, string | boolean>;
  secretValues: Record<string, string>;
  clearSecretKeys: Record<string, boolean>;
};

export type ChannelFieldErrors = Record<string, string[]>;

export const SECTION_LABELS: Record<string, string> = {
  credentials: "Credentials",
  access: "Access",
  delivery: "Delivery",
  advanced: "Advanced",
};

function buildAgentOptions(agents: AgentListResult["agents"]): AgentOption[] {
  return agents.map((agent) => ({
    key: agent.agent_key,
    label:
      agent.persona.name.trim().toLowerCase() === agent.agent_key.trim().toLowerCase()
        ? agent.agent_key
        : `${agent.agent_key} · ${agent.persona.name}`,
  }));
}

export async function loadAgentOptions(http: Pick<OperatorCore["http"], "agentList" | "agents">) {
  if (http.agentList) {
    const result = await http.agentList.get({ include_default: true });
    return buildAgentOptions(result.agents);
  }
  if (http.agents) {
    const result = await http.agents.list();
    return buildAgentOptions(result.agents);
  }
  return [] as AgentOption[];
}

function readFieldValueAsString(value: unknown): string {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").join("\n");
  }
  return typeof value === "string" ? value : "";
}

function readFieldValueAsBoolean(value: unknown): boolean {
  return value === true;
}

export function shouldShowField(
  field: ChannelRegistryEntry["fields"][number],
  state: ChannelFormState,
): boolean {
  if (!field.visible_when) {
    return true;
  }
  return state.configValues[field.visible_when.field_key] === field.visible_when.equals;
}

export function getFieldOptions(
  field: ChannelRegistryEntry["fields"][number],
  agentOptions: readonly AgentOption[],
) {
  if (field.option_source === "agents") {
    return agentOptions.map((agent) => ({ value: agent.key, label: agent.label }));
  }
  return field.options;
}

function getDefaultConfigValue(
  field: ChannelRegistryEntry["fields"][number],
  agentOptions: readonly AgentOption[],
): string | boolean {
  if (field.default_value !== null) {
    return field.default_value;
  }
  if (field.input === "boolean") {
    return false;
  }
  const options = getFieldOptions(field, agentOptions);
  return options[0]?.value ?? "";
}

export function buildInitialFormState(input: {
  entry: ChannelRegistryEntry;
  account?: ConfiguredChannelAccount | null;
  agentOptions: readonly AgentOption[];
}): ChannelFormState {
  const configValues: Record<string, string | boolean> = {};
  for (const field of input.entry.fields) {
    if (field.kind !== "config") {
      continue;
    }
    if (field.input === "boolean") {
      configValues[field.key] = readFieldValueAsBoolean(input.account?.config[field.key]);
      continue;
    }
    const current = readFieldValueAsString(input.account?.config[field.key]);
    configValues[field.key] =
      current || getDefaultConfigValue(field, input.agentOptions).toString();
  }

  return {
    channel: input.entry.channel,
    accountKey: input.account?.account_key ?? "",
    configValues,
    secretValues: {},
    clearSecretKeys: {},
  };
}

export function buildConfigPayload(
  entry: ChannelRegistryEntry,
  state: ChannelFormState,
): Record<string, string | boolean> {
  const payload: Record<string, string | boolean> = {};
  for (const field of entry.fields) {
    if (field.kind !== "config" || !shouldShowField(field, state)) {
      continue;
    }
    const value = state.configValues[field.key];
    if (field.input === "boolean") {
      payload[field.key] = value === true;
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      payload[field.key] = value;
    }
  }
  return payload;
}

export function buildSecretPayload(
  entry: ChannelRegistryEntry,
  state: ChannelFormState,
): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const field of entry.fields) {
    if (field.kind !== "secret" || !shouldShowField(field, state)) {
      continue;
    }
    const value = state.secretValues[field.key]?.trim();
    if (value) {
      payload[field.key] = value;
    }
  }
  return payload;
}

export function renderFieldHelper(field: ChannelRegistryEntry["fields"][number]): React.ReactNode {
  if (!field.description && field.help_lines.length === 0) {
    return undefined;
  }
  return (
    <div className="grid gap-1">
      {field.description ? <span>{field.description}</span> : null}
      {field.help_title ? <span className="font-medium text-fg">{field.help_title}</span> : null}
      {field.help_lines.length > 0 ? (
        <div className="grid gap-0.5">
          {field.help_lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function readChannelFieldErrors(error: unknown): ChannelFieldErrors {
  if (error instanceof TyrumHttpClientError && error.fieldErrors) {
    return error.fieldErrors;
  }
  return {};
}

export function clearChannelFieldError(
  fieldErrors: ChannelFieldErrors,
  fieldKey: string,
): ChannelFieldErrors {
  if (!fieldErrors[fieldKey]) {
    return fieldErrors;
  }
  const next = { ...fieldErrors };
  delete next[fieldKey];
  return next;
}

export function renderConfiguredBadges(
  entry: ChannelRegistryEntry | undefined,
  account: ConfiguredChannelAccount,
) {
  const configuredSecrets = new Set(account.configured_secret_keys);
  const badges: React.ReactElement[] = [];
  if (typeof account.config["agent_key"] === "string" && account.config["agent_key"].trim()) {
    badges.push(
      <Badge key="agent" variant="outline">
        Agent {String(account.config["agent_key"])}
      </Badge>,
    );
  }
  if (typeof account.config["pipeline_enabled"] === "boolean") {
    badges.push(
      <Badge
        key="pipeline"
        variant={account.config["pipeline_enabled"] === true ? "success" : "outline"}
      >
        Pipeline {account.config["pipeline_enabled"] === true ? "enabled" : "disabled"}
      </Badge>,
    );
  }
  for (const field of entry?.fields ?? []) {
    if (field.kind !== "secret") {
      continue;
    }
    badges.push(
      <Badge key={field.key} variant={configuredSecrets.has(field.key) ? "success" : "outline"}>
        {field.label} {configuredSecrets.has(field.key) ? "configured" : "missing"}
      </Badge>,
    );
  }
  return badges;
}
