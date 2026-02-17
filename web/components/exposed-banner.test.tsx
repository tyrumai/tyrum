import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExposedBanner } from "./exposed-banner";

describe("ExposedBanner", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders warning when healthz returns is_exposed=true", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "ok", is_exposed: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ExposedBanner />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This gateway is publicly exposed",
      );
    });
  });

  it("renders nothing when healthz returns is_exposed=false", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "ok", is_exposed: false }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { container } = render(<ExposedBanner />);

    // Wait for fetch to settle
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when healthz omits is_exposed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "ok" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { container } = render(<ExposedBanner />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when healthz request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { container } = render(<ExposedBanner />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    expect(container.innerHTML).toBe("");
  });

  it("has no accessibility violations when banner is shown", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "ok", is_exposed: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { container } = render(<ExposedBanner />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    const { axe } = await import("vitest-axe");
    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });
});
