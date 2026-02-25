import { describe, expect, it } from "vitest";
import { buildAgentTurnKey, encodeTurnKeyPart } from "../../src/modules/agent/turn-key.js";

describe("agent turn key helpers", () => {
  it("builds container-scoped turn keys", () => {
    const key = buildAgentTurnKey({
      agentId: "default",
      workspaceId: "default",
      channel: "telegram",
      containerKind: "dm",
      threadId: "chat-1",
    });

    expect(key).toBe("agent:default:telegram:default:dm:chat-1");
  });

  it("includes delivery account in workspace segment", () => {
    const key = buildAgentTurnKey({
      agentId: "default",
      workspaceId: "default",
      channel: "telegram",
      containerKind: "channel",
      threadId: "chat-1",
      deliveryAccount: "work",
    });

    expect(key).toBe("agent:default:telegram:default~work:channel:chat-1");
  });

  it("encodes ambiguous key parts", () => {
    const raw = "a:b";
    const encoded = encodeTurnKeyPart(raw);
    expect(encoded).not.toBe(raw);
    expect(encoded.startsWith("~")).toBe(true);
  });
});
