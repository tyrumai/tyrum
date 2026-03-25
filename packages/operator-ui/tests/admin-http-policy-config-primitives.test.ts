import { describe, expect, it } from "vitest";
import { formatTimestamp } from "../src/components/pages/admin-http-policy-config-primitives.js";
import { formatDateTime } from "../src/utils/format-date-time.js";

describe("admin-http-policy-config-primitives", () => {
  it("formats saved timestamps with the shared date formatter", () => {
    const timestamp = "2026-01-15T12:00:00.000Z";

    expect(formatTimestamp(timestamp)).toBe(formatDateTime(timestamp));
    expect(formatTimestamp(timestamp)).not.toBe(timestamp);
  });

  it("returns the fallback when no timestamp is present", () => {
    expect(formatTimestamp(null)).toBe("Not saved yet");
  });
});
