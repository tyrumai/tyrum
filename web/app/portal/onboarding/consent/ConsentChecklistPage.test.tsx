import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ConsentChecklistPage from "./page";

const originalFetch = global.fetch;
const originalGetContext = HTMLCanvasElement.prototype.getContext;

describe("ConsentChecklistPage", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(),
    });
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: originalGetContext,
    });
  });

  it("renders the onboarding progress stepper and consent cards", () => {
    render(<ConsentChecklistPage />);

    expect(screen.getByRole("heading", { level: 1, name: /consent checklist/i })).toBeVisible();
    expect(
      screen.getByRole("navigation", { name: /onboarding progress/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
  });

  it("persists consent selections and surfaces the audit reference", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "recorded",
          auditReference: "CONSENT-STUB-0001",
          revision: 1,
          selections: {
            shareCalendarSignals: true,
            allowPlannerAutonomy: true,
            retainAuditTrail: true,
          },
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<ConsentChecklistPage />);

    const toggles = screen.getAllByRole("checkbox");
    await user.click(toggles[0]);
    await user.click(toggles[1]);
    await user.click(toggles[2]);

    await user.click(screen.getByRole("button", { name: /record consent selections/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/onboarding/consent",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );

    const successMessage = await screen.findByRole("status");
    expect(successMessage).toHaveTextContent(/consent recorded as consent-stub-0001/i);
    const summary = screen.getByLabelText(/consent progress summary/i);
    expect(within(summary).getByText(/recorded/i)).toBeVisible();
  });

  it("surfaces an accessible error when the API rejects the payload", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "invalid_selections",
          message: "Select at least one toggle.",
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<ConsentChecklistPage />);

    await user.click(screen.getByRole("button", { name: /record consent selections/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/select at least one toggle/i);
    expect(screen.getByRole("button", { name: /record consent selections/i })).toBeEnabled();
  });

  it("passes an accessibility audit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "recorded",
          auditReference: "CONSENT-STUB-0001",
          revision: 1,
          selections: {
            shareCalendarSignals: true,
            allowPlannerAutonomy: true,
            retainAuditTrail: true,
          },
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const { container } = render(<ConsentChecklistPage />);

    await screen.findByRole("button", { name: /record consent selections/i });
    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });
});
