import React from "react";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import { ActivityFeed } from "./activity-feed";
import type { ActivityEvent } from "../lib/gateway-client";

const sampleEvents: ActivityEvent[] = [
  {
    id: "evt-001",
    event_type: "plan_executed",
    channel: "telegram",
    occurred_at: "2026-02-17T14:00:00.000Z",
    payload: { plan_id: "plan-abc", status: "success" },
  },
  {
    id: "evt-002",
    event_type: "approval_granted",
    channel: "web",
    occurred_at: "2026-02-17T13:30:00.000Z",
    payload: { approval_id: "appr-001" },
  },
];

describe("ActivityFeed", () => {
  it("renders events with type badge, channel, and timestamp", () => {
    render(<ActivityFeed events={sampleEvents} />);

    expect(screen.getByText("plan_executed")).toBeInTheDocument();
    expect(screen.getByText("approval_granted")).toBeInTheDocument();
    expect(screen.getByText("telegram")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();

    const timeElements = screen.getAllByRole("listitem");
    expect(timeElements).toHaveLength(2);
  });

  it("renders payload summary for each event", () => {
    render(<ActivityFeed events={sampleEvents} />);

    expect(
      screen.getByText(/plan_id: plan-abc/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/approval_id: appr-001/),
    ).toBeInTheDocument();
  });

  it("truncates long payload values", () => {
    const longPayloadEvent: ActivityEvent = {
      id: "evt-003",
      event_type: "data_export",
      channel: "api",
      occurred_at: "2026-02-17T12:00:00.000Z",
      payload: { description: "A".repeat(60) },
    };
    render(<ActivityFeed events={[longPayloadEvent]} />);

    expect(
      screen.getByText(`description: ${"A".repeat(40)}...`),
    ).toBeInTheDocument();
  });

  it("shows +N more for payloads with many keys", () => {
    const manyKeysEvent: ActivityEvent = {
      id: "evt-004",
      event_type: "bulk_update",
      channel: "system",
      occurred_at: "2026-02-17T11:00:00.000Z",
      payload: { a: "1", b: "2", c: "3", d: "4", e: "5" },
    };
    render(<ActivityFeed events={[manyKeysEvent]} />);

    expect(screen.getByText(/\+2 more/)).toBeInTheDocument();
  });

  it("shows empty state when no events", () => {
    render(<ActivityFeed events={[]} />);

    expect(
      screen.getByText("No activity recorded yet."),
    ).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <ActivityFeed events={sampleEvents} />,
    );
    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });
});
