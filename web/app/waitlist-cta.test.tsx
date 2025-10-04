import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import WaitlistCta from "./waitlist-cta";

const trackAnalytics = vi.fn();

vi.mock("./lib/analytics", () => ({
  trackAnalytics: (...args: unknown[]) => trackAnalytics(...args),
}));

describe("WaitlistCta", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    trackAnalytics.mockReset();
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "?utm_source=ads&utm_campaign=launch");
  });

  afterEach(() => {
    // @ts-expect-error resetting test stub
    globalThis.fetch = undefined;
  });

  it("submits the email and reports success", async () => {
    const json = vi.fn().mockResolvedValue({ status: "created" });
    globalThis.fetch = vi      .fn()      .mockResolvedValue({
        ok: true,
        status: 201,
        json,
      }) as unknown as typeof fetch;

    render(<WaitlistCta />);

    await user.type(screen.getByLabelText("Email address"), "founder@example.com");
    await user.click(screen.getByRole("button", { name: "Join the waitlist" }));

    await waitFor(() =>
      expect(screen.getByText("You're on the list. We'll keep you posted.")).toBeVisible(),
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/waitlist",
      expect.objectContaining({
        method: "POST",
      }),
    );

    expect(trackAnalytics).toHaveBeenCalledWith("waitlist_signup", {
      status: "success",
      utm_source: "ads",
      utm_campaign: "launch",
    });
  });

  it("surfaces duplicate signups", async () => {
    const json = vi.fn().mockResolvedValue({ error: "duplicate" });
    globalThis.fetch = vi      .fn()      .mockResolvedValue({
        ok: false,
        status: 409,
        json,
      }) as unknown as typeof fetch;

    render(<WaitlistCta />);

    await user.type(screen.getByLabelText("Email address"), "founder@example.com");
    await user.click(screen.getByRole("button", { name: "Join the waitlist" }));

    await waitFor(() =>
      expect(
        screen.getByText("You're already on the waitlist. Thanks for your trust."),
      ).toBeVisible(),
    );

    expect(trackAnalytics).toHaveBeenCalledWith("waitlist_signup", {
      status: "duplicate",
      utm_source: "ads",
      utm_campaign: "launch",
    });
  });

  it("falls back to a friendly error on network failures", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;

    render(<WaitlistCta />);

    await user.type(screen.getByLabelText("Email address"), "founder@example.com");
    await user.click(screen.getByRole("button", { name: "Join the waitlist" }));

    await waitFor(() =>
      expect(
        screen.getByText("We couldn't save that email. Try again in a moment."),
      ).toBeVisible(),
    );

    expect(trackAnalytics).toHaveBeenCalledWith("waitlist_signup", {
      status: "network_error",
      utm_source: "ads",
      utm_campaign: "launch",
    });
  });
});
