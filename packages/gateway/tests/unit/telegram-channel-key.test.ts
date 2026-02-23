import { describe, expect, it } from "vitest";
import { telegramThreadKey } from "../../src/modules/channels/telegram.js";

describe("telegramThreadKey", () => {
  it("does not duplicate account id for derived non-default account keys", () => {
    const key = telegramThreadKey({ id: "thread-1", kind: "group" }, {
      agentId: "agent-1",
      accountId: "work",
    });
    expect(key).toBe("agent:agent-1:telegram-work:group:thread-1");
  });

  it("does not append account twice when channel key already includes account suffix", () => {
    const key = telegramThreadKey({ id: "thread-2", kind: "group" }, {
      agentId: "agent-1",
      accountId: "work",
      channelKey: "telegram-main@work",
    });
    expect(key).toBe("agent:agent-1:telegram-main@work:group:thread-2");
  });

  it("appends account suffix once for generic custom channel keys", () => {
    const key = telegramThreadKey({ id: "thread-3", kind: "group" }, {
      agentId: "agent-1",
      accountId: "work",
      channelKey: "telegram-main",
    });
    expect(key).toBe("agent:agent-1:telegram-main@work:group:thread-3");
  });
});
