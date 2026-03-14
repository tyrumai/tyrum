import type { WsResponseEnvelope } from "@tyrum/schemas";
import type { ConnectedClient } from "../connection-manager.js";
import { handleAiSdkChatMessage } from "./ai-sdk-chat-ops.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";

export async function handleSessionMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  return await handleAiSdkChatMessage(client, msg, deps);
}
