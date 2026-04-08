import { parseTyrumKey } from "@tyrum/contracts";

export function resolveQueuedTelegramAgentId(key: string): string {
  try {
    const parsedKey = parseTyrumKey(key as never);
    if (parsedKey.kind === "agent") {
      return parsedKey.agent_key;
    }
  } catch (err) {
    void err;
  }
  return "default";
}
