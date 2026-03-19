import type { NormalizedAttachment } from "@tyrum/contracts";

export const DEFAULT_CHANNEL_ACCOUNT_ID = "default" as const;

export interface ChannelAddress {
  connector: string;
  accountId: string;
}

export interface ChannelEgressContent {
  text?: string;
  attachments?: NormalizedAttachment[];
}

export interface ChannelEgressRequest {
  accountId: string;
  containerId: string;
  content: ChannelEgressContent;
  parseMode?: string;
}

export interface ChannelTypingRequest {
  accountId: string;
  containerId: string;
}

export interface ChannelEgressConnector {
  connector: string;
  accountId?: string;
  sendMessage(input: ChannelEgressRequest): Promise<unknown>;
  sendTyping?(input: ChannelTypingRequest): Promise<unknown>;
}

function normalizeIdentityPart(kind: "connector" | "account", value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${kind} must be non-empty`);
  }
  if (trimmed.includes(":")) {
    throw new Error(`${kind} must not contain ':'`);
  }
  return trimmed;
}

export function normalizeConnectorId(value: string): string {
  return normalizeIdentityPart("connector", value);
}

export function normalizeAccountId(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    return DEFAULT_CHANNEL_ACCOUNT_ID;
  }
  return normalizeIdentityPart("account", value);
}

export function buildChannelSourceKey(input: ChannelAddress): string {
  const connector = normalizeIdentityPart("connector", input.connector);
  // Treat empty/whitespace account ids as invalid to avoid silently collapsing
  // distinct connector/account identities into the default account.
  if (input.accountId.trim().length === 0) {
    throw new Error("account must be non-empty");
  }
  const accountId = normalizeAccountId(input.accountId);
  return `${connector}:${accountId}`;
}

export function parseChannelSourceKey(source: string): ChannelAddress {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error("channel source must be non-empty");
  }

  const separator = trimmed.indexOf(":");
  if (separator < 0) {
    return {
      connector: normalizeIdentityPart("connector", trimmed),
      accountId: DEFAULT_CHANNEL_ACCOUNT_ID,
    };
  }

  const connector = trimmed.slice(0, separator);
  const accountId = trimmed.slice(separator + 1);
  if (accountId.trim().length === 0) {
    throw new Error("account must be non-empty");
  }
  return {
    connector: normalizeIdentityPart("connector", connector),
    accountId: normalizeAccountId(accountId),
  };
}
