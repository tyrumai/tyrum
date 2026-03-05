import type { WsResponseEnvelope } from "@tyrum/schemas";
import type { ConnectedClient } from "../connection-manager.js";
import {
  handleSessionCompactMessage,
  handleSessionCreateMessage,
  handleSessionGetMessage,
  handleSessionListMessage,
  handleSessionSendMessage,
} from "./session-message-ops.js";
import { handleSessionDeleteMessage } from "./session-delete-ops.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";

export async function handleSessionMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  if (msg.type === "session.list") {
    return handleSessionListMessage(client, msg, deps);
  }
  if (msg.type === "session.get") {
    return handleSessionGetMessage(client, msg, deps);
  }
  if (msg.type === "session.create") {
    return handleSessionCreateMessage(client, msg, deps);
  }
  if (msg.type === "session.compact") {
    return handleSessionCompactMessage(client, msg, deps);
  }
  if (msg.type === "session.delete") {
    return handleSessionDeleteMessage(client, msg, deps);
  }
  if (msg.type === "session.send") {
    return handleSessionSendMessage(client, msg, deps);
  }
  return undefined;
}
