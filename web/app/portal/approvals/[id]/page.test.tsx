import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ApprovalDetailPage from "./page";

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
  useParams: () => ({ id: "appr-001" }),
  usePathname: () => "/portal/approvals/appr-001",
}));

const sampleApproval = {
  id: "appr-001",
  plan_id: "plan-abc",
  step_index: 2,
  prompt: "Approve payment of $50 to Acme Corp for invoice INV-2024-001.",
  context: { vendor: "acme", amount: 5000 },
  status: "pending",
  created_at: "2026-02-17T10:00:00.000Z",
};

describe("ApprovalDetailPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads and displays approval details", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(sampleApproval),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ApprovalDetailPage />);

    expect(screen.getByText("Loading approval...")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText(sampleApproval.prompt),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("plan-abc")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(
      screen.getByText(/"vendor": "acme"/),
    ).toBeInTheDocument();
  });

  it("shows approve and deny buttons for pending approvals", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(sampleApproval),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ApprovalDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Approve" }),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: "Deny" }),
    ).toBeInTheDocument();
  });

  it("does not show action buttons for non-pending approvals", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi
        .fn()
        .mockResolvedValue({ ...sampleApproval, status: "approved" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ApprovalDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Approved")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
  });

  it("approves and shows success feedback", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(sampleApproval),
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

    const user = userEvent.setup();
    render(<ApprovalDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Approve" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.getByText("Approval granted.")).toBeInTheDocument();
    });

    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("denies and shows success feedback", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(sampleApproval),
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

    const user = userEvent.setup();
    render(<ApprovalDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Deny" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Deny" }));

    await waitFor(() => {
      expect(screen.getByText("Approval denied.")).toBeInTheDocument();
    });
  });

  it("shows error when load fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn().mockResolvedValue({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ApprovalDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Gateway request failed: 404",
      );
    });
  });

  it("shows the back to queue link", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(sampleApproval),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ApprovalDetailPage />);

    const backLink = screen.getByRole("link", { name: "Back to queue" });
    expect(backLink).toHaveAttribute("href", "/portal/approvals");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  it("has no accessibility violations when loaded", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(sampleApproval),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { container } = render(<ApprovalDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(sampleApproval.prompt)).toBeInTheDocument();
    });

    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });
});
