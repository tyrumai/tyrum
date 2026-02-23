import { describe, expect, it, vi } from "vitest";

describe("telegram default account id", () => {
  it("respects DEFAULT_CHANNEL_ACCOUNT_ID from the channel interface module", async () => {
    vi.resetModules();

    vi.doMock("../../src/modules/channels/interface.js", () => {
      const DEFAULT_CHANNEL_ACCOUNT_ID = "primary" as const;

      const normalizeAccountId = (value: string | undefined): string => {
        if (!value || value.trim().length === 0) return DEFAULT_CHANNEL_ACCOUNT_ID;
        const trimmed = value.trim();
        if (trimmed.includes(":")) {
          throw new Error("account must not contain ':'");
        }
        return trimmed;
      };

      const buildChannelSourceKey = (input: { connector: string; accountId: string }): string => {
        const connector = input.connector.trim();
        if (!connector) {
          throw new Error("connector must be non-empty");
        }
        if (connector.includes(":")) {
          throw new Error("connector must not contain ':'");
        }
        const accountId = normalizeAccountId(input.accountId);
        return `${connector}:${accountId}`;
      };

      const parseChannelSourceKey = (source: string): { connector: string; accountId: string } => {
        const trimmed = source.trim();
        const sep = trimmed.indexOf(":");
        if (sep < 0) {
          return { connector: trimmed, accountId: DEFAULT_CHANNEL_ACCOUNT_ID };
        }
        return {
          connector: trimmed.slice(0, sep),
          accountId: trimmed.slice(sep + 1),
        };
      };

      return {
        DEFAULT_CHANNEL_ACCOUNT_ID,
        normalizeAccountId,
        buildChannelSourceKey,
        parseChannelSourceKey,
      };
    });

    delete process.env["TYRUM_TELEGRAM_CHANNEL_KEY"];
    delete process.env["TYRUM_TELEGRAM_ACCOUNT_ID"];

    const { telegramThreadKey } = await import("../../src/modules/channels/telegram.js");

    expect(
      telegramThreadKey({ id: "t1", kind: "group" }, { agentId: "agent-1", accountId: "primary" }),
    ).toBe("agent:agent-1:telegram-1:group:t1");
  });
});

