import React from "react";
import { render, screen } from "@testing-library/react";
import Home from "./page";
import {
  CTA_FROM_PARAM,
  CTA_REDIRECT_PARAM,
  CTA_REDIRECT_REASON,
} from "./lib/portal-auth";

type SearchParamRecord = Record<string, string | string[] | undefined>;

function createSearchParams(values: SearchParamRecord) {
  return Object.assign(Promise.resolve(values), values) as Promise<SearchParamRecord>;
}

describe("Home", () => {
  it("renders the hero copy", () => {
    render(<Home searchParams={createSearchParams({})} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "The end of to-do." }),
    ).toBeVisible();

    expect(
      screen.getByText(/No lists\. Just outcomes—captured, handled, and proven\./i),
    ).toBeVisible();
  });

  it("shows the waitlist capture form", () => {
    render(<Home searchParams={createSearchParams({})} />);

    expect(screen.getByLabelText("Email address")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Join the waitlist/i }),
    ).toBeEnabled();
  });

  it("retains the secondary call to action", () => {
    render(<Home searchParams={createSearchParams({})} />);

    expect(screen.getByRole("link", { name: "See how it works" })).toHaveAttribute(
      "href",
      "#value-props",
    );
  });

  it("lists all value propositions", () => {
    render(<Home searchParams={createSearchParams({})} />);

    const items = screen.getAllByRole("heading", { level: 3 });
    expect(items).toHaveLength(3);
  });

  it("surfaces a portal auth redirect notice when onboarding is required", () => {
    render(
      <Home
        searchParams={createSearchParams({
          [CTA_REDIRECT_PARAM]: CTA_REDIRECT_REASON,
          [CTA_FROM_PARAM]: "/portal/inbox",
        })}
      />,
    );

    const notice = screen
      .getAllByRole("status")
      .find((element) =>
        element.textContent?.includes("Access to /portal/inbox requires an active session."),
      );

    expect(notice).toBeDefined();
    expect(notice).toHaveTextContent(
      "Access to /portal/inbox requires an active session. Complete onboarding below to continue.",
    );
  });

  it("provides a generic notice when the redirect source is absent", () => {
    render(
      <Home
        searchParams={createSearchParams({
          [CTA_REDIRECT_PARAM]: CTA_REDIRECT_REASON,
        })}
      />,
    );

    const notice = screen
      .getAllByRole("status")
      .find((element) =>
        element.textContent?.includes("Portal access requires an active session."),
      );

    expect(notice).toBeDefined();
    expect(notice).toHaveTextContent(
      "Portal access requires an active session. Complete onboarding below to continue.",
    );
  });
});
