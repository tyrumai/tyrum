import { describe, expect, it } from "vitest";
import { formatTimestamp } from "../src/components/pages/admin-http-policy-config-primitives.js";
import { getSharedIntl } from "../src/i18n/messages.js";
import { formatDateTime } from "../src/utils/format-date-time.js";

describe("admin-http-policy-config-primitives", () => {
  it("formats saved timestamps with the shared date formatter", () => {
    const timestamp = "2026-01-15T12:00:00.000Z";
    const intl = getSharedIntl("en");

    expect(formatTimestamp(intl, timestamp)).toBe(formatDateTime(timestamp));
    expect(formatTimestamp(intl, timestamp)).not.toBe(timestamp);
  });

  it("returns the fallback when no timestamp is present", () => {
    expect(formatTimestamp(getSharedIntl("en"), null)).toBe("Not saved yet");
  });
});
