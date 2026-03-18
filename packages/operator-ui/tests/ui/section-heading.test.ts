// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("SectionHeading", () => {
  it("renders a div with section-level classes by default", () => {
    const SectionHeading = (operatorUi as Record<string, unknown>)["SectionHeading"];
    expect(SectionHeading).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(
        SectionHeading as React.ComponentType<Record<string, unknown>>,
        null,
        "Section Title",
      ),
    );

    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe("DIV");
    expect(el.textContent).toBe("Section Title");
    expect(el.classList.contains("text-sm")).toBe(true);
    expect(el.classList.contains("font-medium")).toBe(true);

    cleanupTestRoot({ container, root });
  });

  it("renders a semantic heading element with as prop", () => {
    const SectionHeading = (operatorUi as Record<string, unknown>)["SectionHeading"];

    const { container, root } = renderIntoDocument(
      React.createElement(
        SectionHeading as React.ComponentType<Record<string, unknown>>,
        { as: "h2", level: "page" },
        "Page Title",
      ),
    );

    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe("H2");
    expect(el.classList.contains("text-lg")).toBe(true);

    cleanupTestRoot({ container, root });
  });

  it("merges additional className", () => {
    const SectionHeading = (operatorUi as Record<string, unknown>)["SectionHeading"];

    const { container, root } = renderIntoDocument(
      React.createElement(
        SectionHeading as React.ComponentType<Record<string, unknown>>,
        { className: "mt-4" },
        "Custom",
      ),
    );

    const el = container.firstElementChild as HTMLElement;
    expect(el.classList.contains("mt-4")).toBe(true);

    cleanupTestRoot({ container, root });
  });
});
