import { describe, expect, it } from "vitest";
import { decryptToken } from "../src/main/config/token-store.js";
import { normalizeConfigPartialForSave } from "../src/main/config/token-ref-normalizer.js";

describe("normalizeConfigPartialForSave", () => {
  it("returns empty object for non-object partials", () => {
    expect(normalizeConfigPartialForSave(null)).toEqual({});
    expect(normalizeConfigPartialForSave("invalid")).toEqual({});
  });

  it("encrypts remote.tokenRef while preserving other fields", () => {
    const normalized = normalizeConfigPartialForSave({
      mode: "remote",
      remote: {
        wsUrl: "ws://example.test/ws",
        tokenRef: "plain-secret-token",
      },
    });

    const remote = normalized["remote"] as Record<string, unknown>;
    const tokenRef = remote["tokenRef"] as string;

    expect(tokenRef).not.toBe("plain-secret-token");
    expect(decryptToken(tokenRef)).toBe("plain-secret-token");
    expect(remote["wsUrl"]).toBe("ws://example.test/ws");
    expect(normalized["mode"]).toBe("remote");
  });

  it("does not add tokenRef when remote.tokenRef is absent", () => {
    const normalized = normalizeConfigPartialForSave({
      remote: { wsUrl: "ws://example.test/ws" },
    });

    const remote = normalized["remote"] as Record<string, unknown>;
    expect(remote["wsUrl"]).toBe("ws://example.test/ws");
    expect(remote["tokenRef"]).toBeUndefined();
  });

  it("encrypts embedded.tokenRef while preserving other embedded fields", () => {
    const normalized = normalizeConfigPartialForSave({
      embedded: {
        port: 8788,
        tokenRef: "embedded-secret-token",
      },
    });

    const embedded = normalized["embedded"] as Record<string, unknown>;
    const tokenRef = embedded["tokenRef"] as string;

    expect(tokenRef).not.toBe("embedded-secret-token");
    expect(decryptToken(tokenRef)).toBe("embedded-secret-token");
    expect(embedded["port"]).toBe(8788);
  });
});
