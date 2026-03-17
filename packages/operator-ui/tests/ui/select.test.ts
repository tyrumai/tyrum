// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Select", () => {
  it("renders a select element with default classes", () => {
    const Select = (operatorUi as Record<string, unknown>)["Select"];
    expect(Select).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(
        Select as React.ComponentType<Record<string, unknown>>,
        { "data-testid": "test-select" },
        React.createElement("option", { value: "a" }, "Alpha"),
        React.createElement("option", { value: "b" }, "Beta"),
      ),
    );

    const select = container.querySelector("select[data-testid='test-select']");
    expect(select).not.toBeNull();
    expect(select?.classList.contains("rounded-lg")).toBe(true);

    cleanupTestRoot({ container, root });
  });

  it("renders label and helper text in non-bare mode", () => {
    const Select = (operatorUi as Record<string, unknown>)["Select"];

    const { container, root } = renderIntoDocument(
      React.createElement(
        Select as React.ComponentType<Record<string, unknown>>,
        { label: "Pick one", helperText: "Choose wisely" },
        React.createElement("option", { value: "x" }, "X"),
      ),
    );

    expect(container.textContent).toContain("Pick one");
    expect(container.textContent).toContain("Choose wisely");

    const wrapper = container.querySelector("div.grid");
    expect(wrapper).not.toBeNull();

    cleanupTestRoot({ container, root });
  });

  it("renders only the select element in bare mode", () => {
    const Select = (operatorUi as Record<string, unknown>)["Select"];

    const { container, root } = renderIntoDocument(
      React.createElement(
        Select as React.ComponentType<Record<string, unknown>>,
        { bare: true, label: "Ignored label", helperText: "Ignored helper" },
        React.createElement("option", { value: "y" }, "Y"),
      ),
    );

    expect(container.textContent).not.toContain("Ignored label");
    expect(container.textContent).not.toContain("Ignored helper");

    const select = container.querySelector("select");
    expect(select).not.toBeNull();
    expect(select?.parentElement).toBe(container);

    cleanupTestRoot({ container, root });
  });
});
