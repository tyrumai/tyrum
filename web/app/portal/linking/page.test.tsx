import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountLinkingPage from "./page";

const integrationsResponse = {
  account_id: "11111111-2222-3333-4444-555555555555",
  integrations: [
    {
      slug: "calendar-suite",
      name: "Calendar Suite",
      description: "Sync meetings and hold buffers across Google and Outlook calendars.",
      enabled: false,
    },
    {
      slug: "expense-forwarders",
      name: "Expense Forwarders",
      description: "Route receipts and approvals into the planner's spend controls.",
      enabled: true,
    },
  ],
};

describe("AccountLinkingPage", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("loads and displays integration toggles", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(integrationsResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "updated",
            integration: {
              ...integrationsResponse.integrations[0],
              enabled: true,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    global.fetch = fetchMock as unknown as typeof global.fetch;

    const user = userEvent.setup();
    render(<AccountLinkingPage />);

    const calendarToggle = await screen.findByRole("checkbox", {
      name: /calendar suite integration/i,
    });
    expect(calendarToggle).toBeInTheDocument();
    expect(calendarToggle).not.toBeChecked();

    await user.click(calendarToggle);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/account-linking/preferences",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/account-linking/preferences/calendar-suite",
      expect.objectContaining({ method: "PUT" }),
    );

    await waitFor(() => {
      expect(calendarToggle).toBeChecked();
    });

    expect(
      await screen.findByText(/Calendar Suite linked successfully\./i),
    ).toBeInTheDocument();
  });

  it("surfaces an error when the preferences endpoint fails", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: "server_error",
        message: "Unable to load account linking preferences.",
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<AccountLinkingPage />);

    expect(
      await screen.findByText(/unable to load account linking preferences\./i),
    ).toBeInTheDocument();
  });
});
