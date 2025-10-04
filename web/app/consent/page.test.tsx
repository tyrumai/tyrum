import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConsentReviewPage from "./page";
import * as mockPolicy from "./mockPolicy";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConsentReviewPage", () => {
  it("renders the consent chat shell", () => {
    const { container } = render(<ConsentReviewPage />);
    expect(screen.getByRole("heading", { name: /consent review/i })).toBeVisible();
    expect(container.firstChild).toMatchSnapshot();
  });

  it("routes approval clicks through the mocked policy response", async () => {
    const decision = {
      status: "approved" as const,
      reason: "All guardrails satisfied in mock policy.",
      evidence: "test-policy-123",
    };
    const policySpy = vi
      .spyOn(mockPolicy, "requestConsentApproval")
      .mockResolvedValue(decision);

    const user = userEvent.setup();
    render(<ConsentReviewPage />);

    await user.click(screen.getByRole("button", { name: /approve and continue/i }));

    expect(policySpy).toHaveBeenCalledTimes(1);

    const log = await screen.findByRole("log");
    const policyMessage = within(log).getByText((content) => content.includes(decision.evidence));
    expect(policyMessage).toBeVisible();

    const summary = screen.getByLabelText(/policy response summary/i);
    expect(within(summary).getByText(decision.evidence)).toBeVisible();
    expect(within(summary).getByText(/Approved/i)).toBeVisible();

    expect(screen.getByRole("button", { name: /Approved/i })).toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("surfaces an error when the policy request fails", async () => {
    const policySpy = vi
      .spyOn(mockPolicy, "requestConsentApproval")
      .mockRejectedValue(new Error("Mock policy outage"));

    const user = userEvent.setup();
    render(<ConsentReviewPage />);

    await user.click(screen.getByRole("button", { name: /approve and continue/i }));

    expect(policySpy).toHaveBeenCalledTimes(1);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/mock policy outage/i);

    const log = screen.getByRole("log");
    expect(within(log).getByText(/policy decision: failed/i)).toBeVisible();

    const summary = screen.getByLabelText(/policy response summary/i);
    expect(within(summary).getAllByText(/Unavailable/i)).toHaveLength(2);

    expect(screen.getByRole("button", { name: /approve and continue/i })).toBeEnabled();
  });
});
