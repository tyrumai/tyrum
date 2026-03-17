import { describe, expect, it } from "vitest";
import {
  resolveSecretUpdate,
  unique,
} from "../../src/modules/channels/channel-config-registry-shared.js";

describe("channel-config-registry-shared", () => {
  it("normalizes unique string lists via the shared helper", () => {
    expect(unique([" 123 ", "", "123", "456", " 456 "])).toEqual(["123", "456"]);
  });

  it("rejects clearing required secrets without a replacement", () => {
    expect(() =>
      resolveSecretUpdate({
        key: "bot_token",
        label: "Bot token",
        current: "saved-token",
        secrets: {},
        clearSecretKeys: new Set(["bot_token"]),
        required: true,
      }),
    ).toThrow(/Bot token is required/);
  });

  it("allows replacing required secrets and clearing optional ones", () => {
    expect(
      resolveSecretUpdate({
        key: "bot_token",
        label: "Bot token",
        current: "saved-token",
        secrets: {
          bot_token: " fresh-token ",
        },
        clearSecretKeys: new Set(["bot_token"]),
        required: true,
      }),
    ).toBe("fresh-token");

    expect(
      resolveSecretUpdate({
        key: "optional_secret",
        label: "Optional secret",
        current: "saved-secret",
        secrets: {},
        clearSecretKeys: new Set(["optional_secret"]),
      }),
    ).toBeUndefined();
  });
});
