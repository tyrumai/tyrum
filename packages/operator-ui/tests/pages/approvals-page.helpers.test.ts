// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { Approval } from "@tyrum/operator-app";
import { getSharedIntl } from "../../src/i18n/messages.js";
import {
  describeApprovalTableContext,
  describeApprovalOutcome,
  formatTimestamp,
  pickDefaultExpandedApprovalId,
} from "../../src/components/pages/approvals-page.helpers.js";
import { formatDateTime } from "../../src/utils/format-date-time.js";

describe("approvals-page.helpers", () => {
  const nlIntl = getSharedIntl("nl");

  it("formats timestamps from the provided intl locale instead of document.lang", () => {
    document.documentElement.lang = "en";
    const iso = "2025-06-15T12:00:00Z";
    const expected = formatDateTime(iso, undefined, nlIntl.locale);

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

  it("picks the first approval that needs human review for default expansion", () => {
    const queuedApproval = {
      approval_id: "approval-queued",
      status: "queued",
    } as Approval;
    const awaitingHumanApproval = {
      approval_id: "approval-awaiting-human",
      status: "awaiting_human",
    } as Approval;
    const approvedApproval = {
      approval_id: "approval-approved",
      status: "approved",
    } as Approval;

    expect(
      pickDefaultExpandedApprovalId(
        [
          queuedApproval.approval_id,
          awaitingHumanApproval.approval_id,
          approvedApproval.approval_id,
        ],
        {
          [queuedApproval.approval_id]: queuedApproval,
          [awaitingHumanApproval.approval_id]: awaitingHumanApproval,
          [approvedApproval.approval_id]: approvedApproval,
        },
      ),
    ).toBe(awaitingHumanApproval.approval_id);
  });

  it("summarizes desktop approvals for collapsed table rows", () => {
    const approval = {
      approval_id: "approval-desktop",
      status: "awaiting_human",
      context: {
        source: "agent-tool-execution",
        tool_id: "tool.desktop.act",
        args: {
          action: { kind: "click" },
          target: { kind: "a11y", role: "button", name: "Submit" },
        },
      },
    } as Approval;

    expect(describeApprovalTableContext(approval)).toBe(
      "Desktop · act · click · target: a11y (role=button name=Submit)",
    );
  });
});
