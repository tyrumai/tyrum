// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Spinner", () => {
  it("renders an animated svg", () => {
    const Spinner = (operatorUi as Record<string, unknown>)["Spinner"];
    expect(Spinner).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(Spinner as React.ComponentType, { className: "test-spinner" }),
    );

    const svg = container.querySelector("svg.test-spinner");
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains("animate-spin")).toBe(true);

    cleanupTestRoot({ container, root });
  });
});
