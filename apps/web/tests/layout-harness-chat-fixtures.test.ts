import { describe, expect, it } from "vitest";
import { WsConversationCreateResult, WsConversationGetResult } from "@tyrum/contracts";
import { createAiSdkChatWsStub } from "../src/layout-harness-chat-fixtures.js";

describe("layout harness chat fixtures", () => {
  it("returns canonical conversation envelopes for get and create", async () => {
    const socket = createAiSdkChatWsStub();

    const getResult = await socket.requestDynamic(
      "conversation.get",
      { conversation_id: "conversation-1" },
      WsConversationGetResult,
    );
    expect(getResult.conversation.conversation_id).toBe("conversation-1");

    const createResult = await socket.requestDynamic(
      "conversation.create",
      { agent_key: "default", channel: "ui" },
      WsConversationCreateResult,
    );
    expect(createResult.conversation.conversation_id).toBe("conversation-1");
  });
});
