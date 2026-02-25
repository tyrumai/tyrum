import type { NormalizedContainerKind } from "@tyrum/schemas";

export function encodeTurnKeyPart(value: string): string {
  const prefix = "~";
  if (!value.includes(":") && !value.startsWith(prefix)) return value;
  const encoded = Buffer.from(value, "utf-8").toString("base64url");
  return `${prefix}${encoded}`;
}

export type BuildAgentTurnKeyInput = {
  agentId: string;
  workspaceId: string;
  channel: string;
  containerKind: NormalizedContainerKind;
  threadId: string;
  deliveryAccount?: string;
};

export function buildAgentTurnKey(input: BuildAgentTurnKeyInput): string {
  const { agentId, workspaceId, channel, containerKind, threadId, deliveryAccount } = input;
  const safeChannel = encodeTurnKeyPart(channel.trim());
  const safeThread = encodeTurnKeyPart(threadId.trim());
  const rawAccount = deliveryAccount
    ? `${workspaceId.trim()}~${deliveryAccount.trim()}`
    : workspaceId.trim();
  const safeAccount = encodeTurnKeyPart(rawAccount);
  return `agent:${agentId}:${safeChannel}:${safeAccount}:${containerKind}:${safeThread}`;
}
