import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PortalDashboard from "./page";

describe("PortalDashboard", () => {
  it("renders the dashboard heading", () => {
    render(<PortalDashboard />);

    expect(
      screen.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeInTheDocument();
  });

  it("renders all status cards", () => {
    render(<PortalDashboard />);

    expect(
      screen.getByRole("heading", { name: "Gateway", level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Pending Approvals", level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Recent Activity", level: 3 }),
    ).toBeInTheDocument();
  });

  it("displays placeholder values in status cards", () => {
    render(<PortalDashboard />);

    expect(screen.getByText("checking...")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("---")).toBeInTheDocument();
  });
});
