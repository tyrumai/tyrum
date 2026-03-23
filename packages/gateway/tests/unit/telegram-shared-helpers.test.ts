import { describe, expect, it } from "vitest";
import {
  normalizeLane,
  extractMessageText,
  mergeInboundEnvelopes,
  defaultAgentId,
  connectorBindingKey,
} from "../../src/modules/channels/telegram-shared.js";
import type { NormalizedMessageEnvelope, NormalizedThreadMessage } from "@tyrum/contracts";

describe("normalizeLane", () => {
  it("returns 'main' for main input", () => {
    expect(normalizeLane("main")).toBe("main");
  });

  it("returns 'cron' for cron input", () => {
    expect(normalizeLane("cron")).toBe("cron");
  });

  it("returns 'subagent' for subagent input", () => {
    expect(normalizeLane("subagent")).toBe("subagent");
  });

  it("is case-insensitive", () => {
    expect(normalizeLane("MAIN")).toBe("main");
    expect(normalizeLane("Cron")).toBe("cron");
    expect(normalizeLane("SUBAGENT")).toBe("subagent");
  });

  it("trims whitespace", () => {
    expect(normalizeLane("  main  ")).toBe("main");
  });

  it("defaults to 'main' for undefined", () => {
    expect(normalizeLane(undefined)).toBe("main");
  });

  it("defaults to 'main' for unknown lane names", () => {
    expect(normalizeLane("unknown")).toBe("main");
    expect(normalizeLane("heartbeat")).toBe("main");
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
