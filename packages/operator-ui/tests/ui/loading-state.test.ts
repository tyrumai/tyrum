// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("LoadingState", () => {
  it("renders a spinner with default label", () => {
    const LoadingState = (operatorUi as Record<string, unknown>)["LoadingState"];
    expect(LoadingState).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(LoadingState as React.ComponentType),
    );

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(container.textContent).toContain("Loading");

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute("aria-busy")).toBe("true");

    cleanupTestRoot({ container, root });
  });

  it("renders a custom label", () => {
    const LoadingState = (operatorUi as Record<string, unknown>)["LoadingState"];

    const { container, root } = renderIntoDocument(
      React.createElement(LoadingState as React.ComponentType<Record<string, unknown>>, {
        label: "Loading secrets...",
      }),
    );

    expect(container.textContent).toContain("Loading secrets...");

    cleanupTestRoot({ container, root });
  });

  it("applies centered variant classes", () => {
    const LoadingState = (operatorUi as Record<string, unknown>)["LoadingState"];

    const { container, root } = renderIntoDocument(
      React.createElement(LoadingState as React.ComponentType<Record<string, unknown>>, {
        variant: "centered",
      }),
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains("justify-center")).toBe(true);

    cleanupTestRoot({ container, root });
  });

  it("merges additional className", () => {
    const LoadingState = (operatorUi as Record<string, unknown>)["LoadingState"];

    const { container, root } = renderIntoDocument(
      React.createElement(LoadingState as React.ComponentType<Record<string, unknown>>, {
        className: "p-4",
      }),
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains("p-4")).toBe(true);

    cleanupTestRoot({ container, root });
  });
});
