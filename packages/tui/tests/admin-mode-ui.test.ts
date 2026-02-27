import { describe, expect, it, vi } from "vitest";
import { formatAdminModeRemaining } from "../src/admin-mode-ui.js";

describe("formatAdminModeRemaining", () => {
  it("formats remainingMs as m:ss", () => {
    expect(
      formatAdminModeRemaining({
        status: "active",
        elevatedToken: "token",
        enteredAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:01:01.000Z",
        remainingMs: 61_000,
      }),
    ).toBe("1:01");
  });

  it("falls back to expiresAt when remainingMs is null", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    try {
      expect(
        formatAdminModeRemaining({
          status: "active",
          elevatedToken: "token",
          enteredAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2026-01-01T00:01:01.000Z",
          remainingMs: null,
        }),
      ).toBe("1:01");
    } finally {
      vi.useRealTimers();
    }
  });
});
