import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";
import { ApprovalCard } from "./approval-card";

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

const baseProps = {
  id: "appr-001",
  prompt: "Approve payment of $50 to vendor Acme Corp for invoice INV-2024-001.",
  status: "pending" as const,
  createdAt: "2026-02-17T10:00:00.000Z",
};

describe("ApprovalCard", () => {
  it("renders the prompt excerpt and status badge", () => {
    render(<ApprovalCard {...baseProps} />);

    expect(
      screen.getByText(baseProps.prompt),
    ).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("truncates long prompts to 120 characters", () => {
    const longPrompt = "A".repeat(150);
    render(<ApprovalCard {...baseProps} prompt={longPrompt} />);

    expect(
      screen.getByText(`${"A".repeat(120)}...`),
    ).toBeInTheDocument();
  });

  it("renders approve and deny buttons for pending approvals", () => {
    render(<ApprovalCard {...baseProps} />);

    expect(
      screen.getByRole("button", { name: "Approve" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Deny" }),
    ).toBeInTheDocument();
  });

  it("does not render action buttons for non-pending approvals", () => {
    render(<ApprovalCard {...baseProps} status="approved" />);

    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("calls onApprove when the approve button is clicked", async () => {
    const onApprove = vi.fn();
    const user = userEvent.setup();
    render(<ApprovalCard {...baseProps} onApprove={onApprove} />);

    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(onApprove).toHaveBeenCalledWith("appr-001");
  });

  it("calls onDeny when the deny button is clicked", async () => {
    const onDeny = vi.fn();
    const user = userEvent.setup();
    render(<ApprovalCard {...baseProps} onDeny={onDeny} />);

    await user.click(screen.getByRole("button", { name: "Deny" }));

    expect(onDeny).toHaveBeenCalledWith("appr-001");
  });

  it("disables buttons when disabled prop is true", () => {
    render(<ApprovalCard {...baseProps} disabled />);

    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeDisabled();
  });

  it("links to the approval detail page", () => {
    render(<ApprovalCard {...baseProps} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/portal/approvals/appr-001");
  });

  it("renders the correct badge for each status", () => {
    const { rerender } = render(<ApprovalCard {...baseProps} status="denied" />);
    expect(screen.getByText("Denied")).toBeInTheDocument();

    rerender(<ApprovalCard {...baseProps} status="expired" />);
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ApprovalCard {...baseProps} />);
    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });
});
