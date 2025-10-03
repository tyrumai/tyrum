import React from "react";
import { render, screen } from "@testing-library/react";
import Home from "./page";

describe("Home", () => {
  it("renders the headline", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: /Tyrum Local Stack/i })).toBeVisible();
  });
});
