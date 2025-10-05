import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountSettingsPage from "./page";

declare global {
  // eslint-disable-next-line no-var
  var fetch: typeof fetch;
}

describe("AccountSettingsPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockFetch = (payload: unknown, init?: { ok?: boolean; status?: number }) => {
    const ok = init?.ok ?? true;
    const status = init?.status ?? (ok ? 200 : 500);

    return {
      ok,
      status,
      text: vi.fn().mockResolvedValue(JSON.stringify(payload ?? {})),
    } as unknown as Response;
  };

  it("renders the account settings header and description", () => {
    render(<AccountSettingsPage />);

    expect(
      screen.getByRole("heading", { name: "Account Settings", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Control the account lifecycle for your Tyrum workspace. Export archives help you verify that our automation respects consent before requesting deletion.",
      ),
    ).toBeInTheDocument();
  });

  it("queues an export and surfaces a success toast", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        mockFetch({
          status: "enqueued",
          task: { auditReference: "AUDIT-EXPORT-0001" },
        }),
      );

    render(<AccountSettingsPage />);

    await userEvent.click(screen.getByRole("button", { name: "Queue export" }));

    expect(fetchSpy).toHaveBeenCalledWith("/api/account/export", {
      method: "POST",
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    await waitFor(() => {
      expect(screen.getByText(/Data export enqueued/)).toBeInTheDocument();
    });
  });

  it("surfaces an error toast when the deletion request fails", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        mockFetch(
          {
            message: "Deletion currently unavailable.",
          },
          { ok: false, status: 502 },
        ),
      );

    render(<AccountSettingsPage />);

    await userEvent.click(screen.getByRole("button", { name: "Queue deletion" }));

    expect(fetchSpy).toHaveBeenCalledWith("/api/account/delete", {
      method: "POST",
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Deletion currently unavailable.",
      );
    });
  });
});
