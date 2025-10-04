import React from "react";
import { render, screen } from "@testing-library/react";
import Home from "./page";

describe("Home", () => {
  it("renders the hero copy", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { level: 1, name: "The end of to-do." }),
    ).toBeVisible();

    expect(
      screen.getByText(/No lists\. Just outcomes—captured, handled, and proven\./i),
    ).toBeVisible();
  });

  it("shows the waitlist capture form", () => {
    render(<Home />);

    expect(screen.getByLabelText("Email address")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Join the waitlist/i }),
    ).toBeEnabled();
  });

  it("retains the secondary call to action", () => {
    render(<Home />);

    expect(screen.getByRole("link", { name: "See how it works" })).toHaveAttribute(
      "href",
      "#value-props",
    );
  });

  it("lists all value propositions", () => {
    render(<Home />);

    const items = screen.getAllByRole("heading", { level: 3 });
    expect(items).toHaveLength(3);
  });
});
