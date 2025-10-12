import React from "react";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useParams } from "next/navigation";
import PlanTimelinePage from "./page";
import { planTimelineFixture } from "../../__fixtures__/plan-timeline";

vi.mock("next/navigation", () => ({
  useParams: vi.fn(),
}));

const mockedUseParams = vi.mocked(useParams);

const originalFetch = global.fetch;

describe("PortalTimelinePage", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(),
    });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseParams.mockReset();
    mockedUseParams.mockReturnValue({ planId: planTimelineFixture.plan_id });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders the timeline and matches the snapshot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(planTimelineFixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const { container } = render(<PlanTimelinePage />);

    expect(
      await screen.findByText("Hidden for privacy (redacted)."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Planner compiled summary for playback."),
    ).toBeInTheDocument();
    expect(screen.queryByText("[redacted]")).not.toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/audit/plan/${encodeURIComponent(planTimelineFixture.plan_id)}`,
      expect.objectContaining({ method: "GET" }),
    );

    expect(container).toMatchSnapshot();
  });

  it("surfaces an error when the audit API fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "plan_not_found",
          message: "Plan audit timeline not found.",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<PlanTimelinePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Plan audit timeline not found.",
    );
  });

  it("passes an accessibility audit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(planTimelineFixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const { container } = render(<PlanTimelinePage />);

    await screen.findByText("Hidden for privacy (redacted).");

    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });
});
