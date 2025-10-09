import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingStart from "./page";

const trackAnalytics = vi.fn();

vi.mock("../../../lib/analytics", () => ({
  trackAnalytics: (...args: unknown[]) => trackAnalytics(...args),
}));

describe("OnboardingStart", () => {
  beforeEach(() => {
    trackAnalytics.mockReset();
  });

  afterEach(() => {
    trackAnalytics.mockReset();
  });

  it("shows the welcome flash message and tracks analytics when arriving from the waitlist", async () => {
    render(
      <OnboardingStart
        searchParams={{
          flash: "waitlist-welcome",
          signup_status: "created",
          utm_source: "ads",
        }}
      />,
    );

    expect(
      screen.getByText("You're on the list. Let's calibrate Tyrum to your voice."),
    ).toBeVisible();

    await waitFor(() =>
      expect(trackAnalytics).toHaveBeenCalledWith("waitlist_signup", {
        status: "created",
        utm_source: "ads",
      }),
    );
  });

  it("renders the onboarding steps", () => {
    render(<OnboardingStart />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Calibrate voice and consent" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 2, name: "What happens next" }),
    ).toBeVisible();
  });
});
