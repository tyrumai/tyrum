import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlaybooksPage from "./page";

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
  usePathname: () => "/portal/playbooks",
}));

const samplePlaybooks = [
  {
    id: "pb-001",
    name: "Daily Report",
    description: "Generate and send the daily summary report.",
    steps: [
      { action: "gather_data", params: {} },
      { action: "format_report", params: {} },
      { action: "send_email", params: { to: "team@example.com" } },
    ],
    created_at: "2026-02-10T08:00:00.000Z",
  },
  {
    id: "pb-002",
    name: "Backup DB",
    description: "Run a full database backup.",
    steps: [{ action: "pg_dump", params: {} }],
    created_at: "2026-02-12T10:00:00.000Z",
  },
];

describe("PlaybooksPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading state then renders playbook cards", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(samplePlaybooks),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PlaybooksPage />);

    expect(screen.getByText("Loading playbooks...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Daily Report")).toBeInTheDocument();
    });

    expect(screen.getByText("Backup DB")).toBeInTheDocument();
    expect(screen.getByText("3 steps")).toBeInTheDocument();
    expect(screen.getByText("1 step")).toBeInTheDocument();
  });

  it("shows empty state when no playbooks exist", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PlaybooksPage />);

    await waitFor(() => {
      expect(
        screen.getByText("No playbooks available."),
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

    render(<PlaybooksPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Gateway request failed: 500",
      );
    });
  });

  it("runs a playbook and shows success message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(samplePlaybooks),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          run_id: "run-abc",
          status: "started",
          started_at: "2026-02-17T11:00:00Z",
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<PlaybooksPage />);

    await waitFor(() => {
      expect(screen.getByText("Daily Report")).toBeInTheDocument();
    });

    const runButtons = screen.getAllByRole("button", { name: "Run" });
    await user.click(runButtons[0]);

    await waitFor(() => {
      expect(
        screen.getByText("Playbook started. Run ID: run-abc"),
      ).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/playbooks/pb-001/run"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows error when run fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(samplePlaybooks),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: vi.fn().mockResolvedValue({}),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<PlaybooksPage />);

    await waitFor(() => {
      expect(screen.getByText("Daily Report")).toBeInTheDocument();
    });

    const runButtons = screen.getAllByRole("button", { name: "Run" });
    await user.click(runButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Gateway request failed: 503",
      );
    });
  });

  it("renders the page heading", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PlaybooksPage />);

    expect(
      screen.getByRole("heading", { name: "Playbooks", level: 1 }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  it("has no accessibility violations", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(samplePlaybooks),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { container } = render(<PlaybooksPage />);

    await waitFor(() => {
      expect(screen.getByText("Daily Report")).toBeInTheDocument();
    });

    const { axe } = await import("vitest-axe");
    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });
});
