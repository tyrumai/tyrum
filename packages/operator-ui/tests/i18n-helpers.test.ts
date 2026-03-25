// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { formatDateTimeString } from "../src/i18n-helpers.js";
import { getSharedIntl } from "../src/i18n/messages.js";

afterEach(() => {
  document.documentElement.lang = "";
});

describe("i18n-helpers", () => {
  it("formats dates and fallbacks from the provided intl locale", () => {
    document.documentElement.lang = "en";
    const intl = getSharedIntl("nl");
    const timestamp = "2026-01-15T12:00:00.000Z";

    expect(formatDateTimeString(intl, timestamp)).toBe(
      new Intl.DateTimeFormat("nl", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(timestamp)),
    );
    expect(formatDateTimeString(intl, null, "Language")).toBe("Taal");
  });
});
