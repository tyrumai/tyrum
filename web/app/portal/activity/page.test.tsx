import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ActivityPage from "./page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal/activity",
}));

const sampleEvents = [
  {
    id: "evt-001",
    event_type: "plan_executed",
    channel: "telegram",
    occurred_at: "2026-02-17T14:00:00.000Z",
    payload: { plan_id: "plan-abc" },
  },
  {
    id: "evt-002",
    event_type: "approval_granted",
    channel: "web",
    occurred_at: "2026-02-17T15:00:00.000Z",
    payload: { approval_id: "appr-001" },
  },
];

describe("ActivityPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows loading state then renders events", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(sampleEvents),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ActivityPage />);

    expect(screen.getByText("Loading activity...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("plan_executed")).toBeInTheDocument();
    });

    expect(screen.getByText("approval_granted")).toBeInTheDocument();
  });

  it("sorts events by occurred_at descending", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(sampleEvents),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ActivityPage />);

    await waitFor(() => {
      expect(screen.getByText("plan_executed")).toBeInTheDocument();
    });

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // evt-002 (15:00) should appear before evt-001 (14:00)
    expect(items[0].textContent).toContain("approval_granted");
    expect(items[1].textContent).toContain("plan_executed");
  });

  it("shows empty state when no events", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ActivityPage />);

    await waitFor(() => {
      expect(
        screen.getByText("No activity recorded yet."),
      ).toBeInTheDocument();
    });
  });

  it("shows error when fetch fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ActivityPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Gateway request failed: 500",
      );
    });
  });

  it("renders the page heading", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ActivityPage />);

    expect(
      screen.getByRole("heading", { name: "Activity", level: 1 }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});
