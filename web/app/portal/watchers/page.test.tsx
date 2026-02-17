import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WatchersPage from "./page";

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

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal/watchers",
}));

const sampleWatchers = [
  {
    id: "w-001",
    trigger_type: "periodic" as const,
    trigger_config: { intervalMs: 60000 },
    plan_id: "plan-abc",
    active: true,
    created_at: "2026-02-15T10:00:00.000Z",
  },
  {
    id: "w-002",
    trigger_type: "plan_complete" as const,
    trigger_config: {},
    plan_id: "plan-def",
    active: false,
    created_at: "2026-02-16T08:00:00.000Z",
  },
];

describe("WatchersPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading state then renders watcher cards", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(sampleWatchers),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<WatchersPage />);

    expect(screen.getByText("Loading watchers...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("w-001")).toBeInTheDocument();
    });

    expect(screen.getByText("w-002")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("shows empty state when no watchers exist", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<WatchersPage />);

    await waitFor(() => {
      expect(
        screen.getByText("No watchers configured."),
      ).toBeInTheDocument();
    });
  });

  it("shows error when fetch fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<WatchersPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Gateway request failed: 500",
      );
    });
  });

  it("creates a new watcher via the form", async () => {
    const newWatcher = {
      id: "w-003",
      trigger_type: "periodic" as const,
      trigger_config: { intervalMs: 60000 },
      plan_id: "plan-new",
      active: true,
      created_at: "2026-02-17T12:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(newWatcher),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<WatchersPage />);

    await waitFor(() => {
      expect(
        screen.getByText("No watchers configured."),
      ).toBeInTheDocument();
    });

    await user.clear(screen.getByLabelText("Plan ID"));
    await user.type(screen.getByLabelText("Plan ID"), "plan-new");
    await user.click(
      screen.getByRole("button", { name: "Create Watcher" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Watcher w-003 created.")).toBeInTheDocument();
    });

    expect(screen.getByText("w-003")).toBeInTheDocument();

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/watchers"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          trigger_type: "periodic",
          trigger_config: { intervalMs: 60000 },
          plan_id: "plan-new",
        }),
      }),
    );
  });

  it("toggles a watcher active/inactive", async () => {
    const updatedWatcher = { ...sampleWatchers[0], active: false };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(sampleWatchers),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(updatedWatcher),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<WatchersPage />);

    await waitFor(() => {
      expect(screen.getByText("w-001")).toBeInTheDocument();
    });

    // w-001 is active, so button should say "Deactivate"
    await user.click(
      screen.getAllByRole("button", { name: "Deactivate" })[0],
    );

    await waitFor(() => {
      expect(
        screen.getByText("Watcher w-001 deactivated."),
      ).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/watchers/w-001"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ active: false }),
      }),
    );
  });

  it("deletes a watcher", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(sampleWatchers),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(null),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<WatchersPage />);

    await waitFor(() => {
      expect(screen.getByText("w-001")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    await user.click(deleteButtons[0]);

    await waitFor(() => {
      expect(
        screen.getByText("Watcher w-001 deleted."),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("w-001")).not.toBeInTheDocument();
  });

  it("renders the page heading", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<WatchersPage />);

    expect(
      screen.getByRole("heading", { name: "Watchers", level: 1 }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  it("has no accessibility violations", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(sampleWatchers),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { container } = render(<WatchersPage />);

    await waitFor(() => {
      expect(screen.getByText("w-001")).toBeInTheDocument();
    });

    const { axe } = await import("vitest-axe");
    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });
});
