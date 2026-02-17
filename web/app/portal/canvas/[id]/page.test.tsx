import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CanvasViewerPage from "./page";

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
  useParams: () => ({ id: "canvas-001" }),
  usePathname: () => "/portal/canvas/canvas-001",
}));

const sampleMeta = {
  id: "canvas-001",
  title: "Weekly Report",
  content_type: "text/html",
  created_at: "2026-02-17T10:00:00.000Z",
};

const sampleHtml = "<h1>Weekly Report</h1><p>Content here</p>";

describe("CanvasViewerPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads and displays canvas metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(sampleMeta),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue(sampleHtml),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<CanvasViewerPage />);

    expect(screen.getByText("Loading canvas...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Weekly Report")).toBeInTheDocument();
    });

    expect(screen.getByText("text/html")).toBeInTheDocument();
  });

  it("renders iframe with sandbox attribute", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(sampleMeta),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue(sampleHtml),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<CanvasViewerPage />);

    await waitFor(() => {
      expect(screen.getByTitle("Weekly Report")).toBeInTheDocument();
    });

    const iframe = screen.getByTitle("Weekly Report") as HTMLIFrameElement;
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(iframe.getAttribute("srcdoc")).toBe(sampleHtml);
  });

  it("does NOT include allow-scripts in sandbox", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(sampleMeta),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue(sampleHtml),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<CanvasViewerPage />);

    await waitFor(() => {
      expect(screen.getByTitle("Weekly Report")).toBeInTheDocument();
    });

    const iframe = screen.getByTitle("Weekly Report");
    const sandboxAttr = iframe.getAttribute("sandbox") ?? "";
    expect(sandboxAttr).not.toContain("allow-scripts");
  });

  it("shows error when meta fetch fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn().mockResolvedValue({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<CanvasViewerPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Gateway request failed: 404",
      );
    });
  });

  it("shows the back link", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(sampleMeta),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue(sampleHtml),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<CanvasViewerPage />);

    const backLink = screen.getByRole("link", {
      name: "Back to canvas list",
    });
    expect(backLink).toHaveAttribute("href", "/portal/canvas");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  it("has no accessibility violations when loaded", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(sampleMeta),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue(sampleHtml),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { container } = render(<CanvasViewerPage />);

    await waitFor(() => {
      expect(screen.getByTitle("Weekly Report")).toBeInTheDocument();
    });

    // Remove iframe before running axe -- axe-core cannot inspect sandboxed
    // iframes in jsdom (no real frame window to postMessage into).
    const iframe = container.querySelector("iframe");
    iframe?.remove();

    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });
});
