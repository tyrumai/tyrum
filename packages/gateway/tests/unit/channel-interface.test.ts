import { describe, expect, it } from "vitest";
import { buildChannelSourceKey, parseChannelSourceKey } from "../../src/modules/channels/interface.js";

describe("channel interface source identity", () => {
  it("builds and parses connector/account keys", () => {
    const source = buildChannelSourceKey({ connector: "telegram", accountId: "work" });
    expect(source).toBe("telegram:work");

    expect(parseChannelSourceKey(source)).toEqual({
      connector: "telegram",
      accountId: "work",
    });
  });

  it("parses legacy source values as default account", () => {
    expect(parseChannelSourceKey("telegram")).toEqual({
      connector: "telegram",
      accountId: "default",
    });
  });

  it("rejects invalid source key parts", () => {
    expect(() => buildChannelSourceKey({ connector: "telegram:test", accountId: "work" })).toThrow(
      /must not contain ':'/,
    );
    expect(() => buildChannelSourceKey({ connector: "telegram", accountId: "work:ops" })).toThrow(
      /must not contain ':'/,
    );
  });
});
