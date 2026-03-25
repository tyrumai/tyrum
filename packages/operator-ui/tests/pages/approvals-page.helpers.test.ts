// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { getSharedIntl } from "../../src/i18n/messages.js";
import {
  describeApprovalOutcome,
  formatTimestamp,
} from "../../src/components/pages/approvals-page.helpers.js";

describe("approvals-page.helpers", () => {
  const nlIntl = getSharedIntl("nl");

  it("formats timestamps from the provided intl locale instead of document.lang", () => {
    document.documentElement.lang = "en";
    const iso = "2025-06-15T12:00:00Z";
    const expected = nlIntl.formatDate(new Date(iso), {
      dateStyle: "medium",
      timeStyle: "short",
    });

    expect(formatTimestamp(nlIntl, iso)).toBe(expected);

    document.documentElement.lang = "";
  });

  it("describes approval outcomes from the provided intl locale", () => {
    document.documentElement.lang = "en";

    expect(describeApprovalOutcome(nlIntl, "approved")).toBe("Afgehandeld als goedgekeurd.");
    expect(describeApprovalOutcome(nlIntl, "denied")).toBe("Afgehandeld als afgewezen.");
    expect(describeApprovalOutcome(nlIntl, "reviewing")).toBe(
      "Beoordeling door Guardian is bezig.",
    );

    document.documentElement.lang = "";
  });
});
