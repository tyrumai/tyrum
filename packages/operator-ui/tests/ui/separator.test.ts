// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Separator", () => {
  it("renders a Radix separator", () => {
    const Separator = (operatorUi as Record<string, unknown>)["Separator"];
    expect(Separator).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(Separator as React.ComponentType, {
        orientation: "vertical",
        className: "test-separator",
      }),
    );

    const el = container.querySelector('[role="separator"].test-separator');
    expect(el).not.toBeNull();
    expect(el?.getAttribute("data-orientation")).toBe("vertical");
    expect(el?.className).toContain("bg-border");

    cleanupTestRoot({ container, root });
  });
});
