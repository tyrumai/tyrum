// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Badge", () => {
  it("renders and supports variants", () => {
    const Badge = (operatorUi as Record<string, unknown>)["Badge"];
    expect(Badge).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(
        Badge as React.ComponentType,
        { variant: "success", className: "test-badge" },
        "OK",
      ),
    );

    const el = container.querySelector(".test-badge");
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("OK");
    expect(el?.className).toContain("bg-success");
    expect(el?.className).not.toContain("rounded-full");

    cleanupTestRoot({ container, root });
  });
});
