import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ApprovalsPage from "./page";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal/approvals",
}));

const sampleApprovals = [
  {
    id: "appr-001",
    plan_id: "plan-abc",
    step_index: 0,
    prompt: "Approve payment of $50 to Acme Corp.",
    context: { vendor: "acme" },
    status: "pending",
    created_at: "2026-02-17T10:00:00.000Z",
  },
  {
    id: "appr-002",
    plan_id: "plan-def",
    step_index: 1,
    prompt: "Send weekly report email.",
    context: { report_type: "weekly" },
    status: "approved",
    created_at: "2026-02-16T08:00:00.000Z",
    responded_at: "2026-02-16T09:00:00.000Z",
  },
];

describe("ApprovalsPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows loading state then renders approval cards", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(sampleApprovals),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ApprovalsPage />);

    expect(screen.getByText("Loading approvals...")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText("Approve payment of $50 to Acme Corp."),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Send weekly report email.")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("shows empty state when no approvals exist", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByText("No approvals yet.")).toBeInTheDocument();
    });
  });

  it("shows error when fetch fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Gateway request failed: 500",
      );
    });
  });

  it("approves an approval and shows success message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(sampleApprovals),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: "appr-001",
          status: "approved",
          responded_at: "2026-02-17T11:00:00.000Z",
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Approve payment of $50 to Acme Corp."),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(
        screen.getByText("Approval appr-001 approved."),
      ).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/approvals/appr-001/respond"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ decision: "approved", reason: undefined }),
      }),
    );
  });

  it("denies an approval and shows success message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(sampleApprovals),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: "appr-001",
          status: "denied",
          responded_at: "2026-02-17T11:00:00.000Z",
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Approve payment of $50 to Acme Corp."),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Deny" }));

    await waitFor(() => {
      expect(
        screen.getByText("Approval appr-001 denied."),
      ).toBeInTheDocument();
    });
  });

  it("renders the page heading", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ApprovalsPage />);

    expect(
      screen.getByRole("heading", { name: "Approval Queue", level: 1 }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});
