import React from "react";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";
import { PortalNav } from "./portal-nav";

let mockPathname = "/portal";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

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

describe("PortalNav", () => {
  it("renders all navigation links", () => {
    render(<PortalNav />);

    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Approvals" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Playbooks" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Canvas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("marks the current page link with aria-current", () => {
    mockPathname = "/portal/settings";
    render(<PortalNav />);

    const settingsLink = screen.getByRole("link", { name: "Settings" });
    expect(settingsLink).toHaveAttribute("aria-current", "page");

    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink).not.toHaveAttribute("aria-current");
  });

  it("has no accessibility violations", async () => {
    mockPathname = "/portal";
    const { container } = render(<PortalNav />);
    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });
});
