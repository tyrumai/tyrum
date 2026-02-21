export type DmScope =
  | "shared"
  | "per_peer"
  | "per_channel_peer"
  | "per_account_channel_peer";

export type ContainerKind = "dm" | "group" | "channel";

function safePart(value: string): string {
  // Key parts must not contain ":"; keep it simple and deterministic.
  return value.replace(/:/g, "_");
}

export function formatAgentSessionKey(input: {
  agentId: string;
  channel?: string;
  accountId?: string;
  containerKind: ContainerKind;
  containerId?: string;
  peerId?: string;
  dmScope?: DmScope;
}): string {
  const agentId = safePart(input.agentId);
  const channel = input.channel ? safePart(input.channel) : undefined;
  const accountId = input.accountId ? safePart(input.accountId) : undefined;

  if (input.containerKind === "dm") {
    const scope = input.dmScope ?? "per_account_channel_peer";
    const peerId = input.peerId ? safePart(input.peerId) : undefined;

    switch (scope) {
      case "shared":
        return `agent:${agentId}:main`;
      case "per_peer":
        if (!peerId) throw new Error("dm session key requires peerId for per_peer scope");
        return `agent:${agentId}:dm:${peerId}`;
      case "per_channel_peer":
        if (!channel) throw new Error("dm session key requires channel for per_channel_peer scope");
        if (!peerId) throw new Error("dm session key requires peerId for per_channel_peer scope");
        return `agent:${agentId}:${channel}:dm:${peerId}`;
      case "per_account_channel_peer":
        if (!channel) throw new Error("dm session key requires channel for per_account_channel_peer scope");
        if (!accountId) throw new Error("dm session key requires accountId for per_account_channel_peer scope");
        if (!peerId) throw new Error("dm session key requires peerId for per_account_channel_peer scope");
        return `agent:${agentId}:${channel}:${accountId}:dm:${peerId}`;
    }
  }

  const containerId = input.containerId ? safePart(input.containerId) : undefined;
  if (!channel) throw new Error("non-dm session key requires channel");
  if (!accountId) throw new Error("non-dm session key requires accountId");
  if (!containerId) throw new Error("non-dm session key requires containerId");

  if (input.containerKind === "group") {
    return `agent:${agentId}:${channel}:${accountId}:group:${containerId}`;
  }

  return `agent:${agentId}:${channel}:${accountId}:channel:${containerId}`;
}

