import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WaitlistCta from "./waitlist-cta";

const trackAnalytics = vi.fn();

vi.mock("./lib/analytics", () => ({
  trackAnalytics: (...args: unknown[]) => trackAnalytics(...args),
}));

describe("WaitlistCta", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    trackAnalytics.mockReset();
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("renders duplicate notice from search params and tracks analytics", () => {
    window.history.replaceState(
      {},
      "",
      "/?utm_source=ads&utm_campaign=launch&waitlist_status=duplicate",
    );

    render(<WaitlistCta />);

    expect(
      screen.getByText("You're already on the waitlist. Thanks for your trust."),
    ).toBeVisible();

    expect(trackAnalytics).toHaveBeenCalledWith("waitlist_signup", {
      status: "duplicate",
      utm_source: "ads",
      utm_campaign: "launch",
    });
  });

  it("prevents blank submissions and surfaces the validation message", async () => {
    window.history.replaceState({}, "", "/?utm_source=ads");

    render(<WaitlistCta />);

    await user.clear(screen.getByLabelText("Email address"));
    await user.type(screen.getByLabelText("Email address"), "   ");
    await user.click(screen.getByRole("button", { name: "Join the waitlist" }));

    await waitFor(() =>
      expect(
        screen.getByText("That doesn't look like a valid email. Please try again."),
      ).toBeVisible(),
    );

    expect(trackAnalytics).toHaveBeenCalledWith("waitlist_signup", {
      status: "invalid",
      utm_source: "ads",
    });
  });

  it("prefills the email field when the query parameter is present", () => {
    window.history.replaceState(
      {},
      "",
      "/?waitlist_status=invalid_email&waitlist_email=founder%40example.com",
    );

    render(<WaitlistCta />);

    const emailInput = screen.getByLabelText("Email address") as HTMLInputElement;
    expect(emailInput.value).toBe("founder@example.com");
    expect(
      screen.getByText("That doesn't look like a valid email. Please try again."),
    ).toBeVisible();
  });
});
