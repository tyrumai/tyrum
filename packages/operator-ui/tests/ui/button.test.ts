// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Button", () => {
  it("renders a <button> by default", () => {
    const Button = (operatorUi as Record<string, unknown>)["Button"];
    expect(Button).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(
        Button as React.ComponentType,
        { type: "button", className: "test-button" },
        "Click",
      ),
    );

    const el = container.querySelector("button.test-button");
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("Click");
    expect(el?.className).toContain("bg-primary");

    cleanupTestRoot({ container, root });
  });

  it("supports asChild via Radix Slot", () => {
    const Button = (operatorUi as Record<string, unknown>)["Button"];
    expect(Button).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(
        Button as React.ComponentType,
        { asChild: true, className: "test-button" },
        React.createElement("a", { href: "#", className: "test-anchor" }, "Link"),
      ),
    );

    expect(container.querySelector("button")).toBeNull();
    const anchor = container.querySelector("a.test-anchor");
    expect(anchor).not.toBeNull();
    expect(anchor?.className).toContain("test-button");

    cleanupTestRoot({ container, root });
  });

  it("disables and shows a spinner when loading", () => {
    const Button = (operatorUi as Record<string, unknown>)["Button"];
    expect(Button).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(
        Button as React.ComponentType,
        { isLoading: true, className: "test-button" },
        "Saving",
      ),
    );

    const el = container.querySelector("button.test-button") as HTMLButtonElement | null;
    expect(el).not.toBeNull();
    expect(el?.disabled).toBe(true);
    expect(el?.querySelector("svg")).not.toBeNull();

    cleanupTestRoot({ container, root });
  });
});
