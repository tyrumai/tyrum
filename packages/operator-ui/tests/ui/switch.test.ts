// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Switch", () => {
  it("renders a checked switch with a thumb", () => {
    const Switch = (operatorUi as Record<string, unknown>)["Switch"];
    expect(Switch).toBeDefined();

    const { root, container } = renderIntoDocument(
      React.createElement(Switch as React.ComponentType, {
        id: "test-switch",
        checked: true,
        onCheckedChange: () => {},
        className: "test-switch",
      }),
    );

    const el = container.querySelector("button.test-switch");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("data-state")).toBe("checked");
    expect(el?.className).toContain("border-2");
    expect(el?.className).toContain("border-transparent");
    expect(el?.className).not.toContain("border-border");
    expect(el?.className).not.toContain("data-[state=checked]:border-primary");

    const thumb = container.querySelector("button.test-switch [data-switch-thumb]");
    expect(thumb).not.toBeNull();

    cleanupTestRoot({ root, container });
  });
});
