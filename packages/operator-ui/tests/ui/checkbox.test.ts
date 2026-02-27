// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Checkbox", () => {
  it("renders a checked checkbox with an indicator icon", () => {
    const Checkbox = (operatorUi as Record<string, unknown>)["Checkbox"];
    expect(Checkbox).toBeDefined();

    const { root, container } = renderIntoDocument(
      React.createElement(Checkbox as React.ComponentType, {
        id: "test-checkbox",
        checked: true,
        onCheckedChange: () => {},
        className: "test-checkbox",
      }),
    );

    const el = container.querySelector("button.test-checkbox");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("data-state")).toBe("checked");
    expect(el?.querySelector("svg")).not.toBeNull();

    cleanupTestRoot({ root, container });
  });
});
