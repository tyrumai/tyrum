import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingStart from "./page";

const trackAnalytics = vi.fn();
const originalFetch = global.fetch;

type SearchParamRecord = Record<string, string | string[] | undefined>;

function createSearchParams(values: SearchParamRecord) {
  return Object.assign(Promise.resolve(values), values) as Promise<SearchParamRecord>;
}

vi.mock("../../../lib/analytics", () => ({
  trackAnalytics: (...args: unknown[]) => trackAnalytics(...args),
}));

describe("OnboardingStart", () => {
  beforeEach(() => {
    trackAnalytics.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-10-12T10:00:00.000Z"));
  });

  afterEach(() => {
    trackAnalytics.mockReset();
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it("shows the welcome flash message and tracks analytics when arriving from the waitlist", async () => {
    render(
      <OnboardingStart
        searchParams={createSearchParams({
          flash: "waitlist-welcome",
          signup_status: "created",
          utm_source: "ads",
        })}
      />,
    );

    expect(
      screen.getByText("You're on the list. Let's calibrate Tyrum to your voice."),
    ).toBeVisible();

    await vi.runOnlyPendingTimersAsync();
    expect(trackAnalytics).toHaveBeenCalledWith("waitlist_signup", {
      status: "created",
      utm_source: "ads",
    });
  });

  it(
    "guides the user through calibration and posts the payload to consent stub",
    async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "recorded",
          auditReference: "CONSENT-STUB-0001",
          revision: 1,
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<OnboardingStart />);

    fireEvent.click(screen.getByRole("button", { name: /start calibration/i }));
    fireEvent.click(screen.getByLabelText(/upbeat/i));
    fireEvent.click(screen.getByRole("button", { name: /next prompt/i }));
    fireEvent.click(screen.getByLabelText(/balanced/i));
    fireEvent.click(screen.getByRole("button", { name: /next prompt/i }));
    fireEvent.click(screen.getByLabelText(/act within limits/i));
    fireEvent.click(screen.getByRole("button", { name: /next prompt/i }));
    fireEvent.click(screen.getByLabelText(/21:00 – 07:00/i));
    fireEvent.click(screen.getByRole("button", { name: /next prompt/i }));
    fireEvent.click(screen.getByLabelText(/up to €50/i));
    fireEvent.click(screen.getByRole("button", { name: /next prompt/i }));
    fireEvent.click(screen.getByLabelText(/warm/i));
    fireEvent.click(screen.getByRole("button", { name: /next prompt/i }));
    fireEvent.click(screen.getByLabelText(/share scheduling signals/i));
    fireEvent.click(screen.getByRole("button", { name: /review selections/i }));

    vi.setSystemTime(new Date("2025-10-12T10:00:24.000Z"));

    fireEvent.click(screen.getByRole("button", { name: /record calibration/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestInit.method).toBe("POST");
    const body = JSON.parse(requestInit.body as string) as {
      selections: Record<string, boolean>;
      calibration: {
        persona: Record<string, string>;
        durationSeconds: number;
        startedAt: string;
        completedAt: string;
      };
    };
    expect(body.selections).toMatchObject({
      shareCalendarSignals: true,
      allowPlannerAutonomy: false,
      retainAuditTrail: false,
    });
    expect(body.calibration.persona).toMatchObject({
      tone: "upbeat",
      verbosity: "balanced",
      initiative: "act_within_limits",
      quietHours: "21-07",
      spending: "50",
      voice: "warm",
    });
    expect(body.calibration.durationSeconds).toBe(24);
    expect(body.calibration.startedAt).toBe("2025-10-12T10:00:00.000Z");
    expect(body.calibration.completedAt).toBe("2025-10-12T10:00:24.000Z");

    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByRole("heading", { level: 2, name: /calibration recorded/i }),
    ).toBeVisible();
    expect(screen.getByText(/CONSENT-STUB-0001/i)).toBeVisible();
    },
    10000,
  );

  it(
    "expires the flow if the countdown reaches zero",
    async () => {
    render(<OnboardingStart />);

    fireEvent.click(screen.getByRole("button", { name: /start calibration/i }));
    act(() => {
      vi.advanceTimersByTime(91_000);
    });

    expect(
      screen.getByRole("heading", { level: 2, name: /calibration expired/i }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /restart calibration/i })).toBeEnabled();
    },
    10000,
  );
});
