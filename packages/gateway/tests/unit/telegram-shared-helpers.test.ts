import { describe, expect, it, vi } from "vitest";
import {
  extractMessageText,
  mergeInboundEnvelopes,
  defaultAgentId,
  connectorBindingKey,
  isInteractiveConversationKey,
  createTelegramEgressConnector,
} from "../../src/modules/channels/telegram-shared.js";
import type { NormalizedMessageEnvelope, NormalizedThreadMessage } from "@tyrum/contracts";

describe("isInteractiveConversationKey", () => {
  it("treats the main conversation as interactive", () => {
    expect(isInteractiveConversationKey("agent:default:main")).toBe(true);
  });

  it("treats automation conversations as non-interactive", () => {
    expect(isInteractiveConversationKey("agent:default:automation:daily-report")).toBe(false);
  });

  it("treats subagent conversations as non-interactive", () => {
    expect(isInteractiveConversationKey("agent:default:subagent:123")).toBe(false);
  });
});

describe("extractMessageText", () => {
  it("returns message text", () => {
    const msg = {
      message: { content: { text: "hello" } },
    } as unknown as NormalizedThreadMessage;
    expect(extractMessageText(msg)).toBe("hello");
  });

  it("returns empty string when text is undefined", () => {
    const msg = {
      message: { content: { text: undefined } },
    } as unknown as NormalizedThreadMessage;
    expect(extractMessageText(msg)).toBe("");
  });

  it("returns empty string when text is null", () => {
    const msg = {
      message: { content: { text: null } },
    } as unknown as NormalizedThreadMessage;
    expect(extractMessageText(msg)).toBe("");
  });
});

describe("mergeInboundEnvelopes", () => {
  it("returns undefined for empty array", () => {
    expect(mergeInboundEnvelopes([], "merged")).toBeUndefined();
  });

  it("merges text and attachments from multiple envelopes", () => {
    const env1: NormalizedMessageEnvelope = {
      content: {
        text: "first",
        attachments: [{ artifact_id: "a1", kind: "file" }],
      },
      provenance: ["user" as never],
    };
    const env2: NormalizedMessageEnvelope = {
      content: {
        text: "second",
        attachments: [{ artifact_id: "a2", kind: "file" }],
      },
      provenance: ["tool" as never],
    };
    const result = mergeInboundEnvelopes([env1, env2], "merged text");
    expect(result).toBeDefined();
    expect(result!.content.text).toBe("merged text");
    expect(result!.content.attachments).toHaveLength(2);
  });

  it("uses base provenance when no provenance tags exist", () => {
    const env: NormalizedMessageEnvelope = {
      content: { text: "test", attachments: [] },
      provenance: [],
    };
    const result = mergeInboundEnvelopes([env], "text");
    expect(result).toBeDefined();
    expect(result!.provenance).toEqual([]);
  });

  it("sets text to undefined when merged text is empty", () => {
    const env: NormalizedMessageEnvelope = {
      content: { text: "original", attachments: [] },
      provenance: [],
    };
    const result = mergeInboundEnvelopes([env], "");
    expect(result).toBeDefined();
    expect(result!.content.text).toBeUndefined();
  });
});

describe("defaultAgentId", () => {
  it("returns 'default'", () => {
    expect(defaultAgentId()).toBe("default");
  });
});

describe("connectorBindingKey", () => {
  it("returns connector id when no accountId", () => {
    const result = connectorBindingKey({
      connector: "telegram",
      sendMessage: async () => undefined,
    });
    expect(result).toBe("telegram");
  });

  it("returns connector:accountId when accountId is provided", () => {
    const result = connectorBindingKey({
      connector: "telegram",
      accountId: "bot1",
      sendMessage: async () => undefined,
    });
    expect(result).toBe("telegram:bot1");
  });
});

describe("createTelegramEgressConnector", () => {
  it("emits egress debug logs for text sends when enabled", async () => {
    const logger = { info: vi.fn() };
    const telegramBot = {
      sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 7 } })),
    } as never;

    const connector = createTelegramEgressConnector(telegramBot, {
      accountId: "work",
      logger: logger as never,
      debugLoggingEnabled: true,
    });

    await connector.sendMessage({
      accountId: "work",
      containerId: "chat-1",
      content: {
        text: "hello",
        attachments: [],
      },
      parseMode: "HTML",
    });

    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.debug.egress_attempt",
      expect.objectContaining({
        account_key: "work",
        method: "sendMessage",
        chat_id: "chat-1",
        request: expect.objectContaining({
          text: "hello",
          text_length: 5,
          attachment_count: 0,
          parse_mode: "HTML",
        }),
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.debug.egress_result",
      expect.objectContaining({
        account_key: "work",
        method: "sendMessage",
        chat_id: "chat-1",
        response: { ok: true, result: { message_id: 7 } },
      }),
    );
  });

  it("emits egress failure diagnostics when text sends fail", async () => {
    const logger = { info: vi.fn() };
    const telegramBot = {
      sendMessage: vi.fn(async () => {
        throw new Error("telegram send failed");
      }),
    } as never;

    const connector = createTelegramEgressConnector(telegramBot, {
      accountId: "work",
      logger: logger as never,
      debugLoggingEnabled: true,
    });

    await expect(
      connector.sendMessage({
        accountId: "work",
        containerId: "chat-1",
        content: {
          text: "hello",
          attachments: [],
        },
        parseMode: "HTML",
      }),
    ).rejects.toThrow("telegram send failed");

    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.debug.egress_failed",
      expect.objectContaining({
        account_key: "work",
        method: "sendMessage",
        chat_id: "chat-1",
        error: "telegram send failed",
      }),
    );
  });
});
