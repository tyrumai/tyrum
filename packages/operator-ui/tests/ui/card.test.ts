// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Card", () => {
  it("renders Card subcomponents", () => {
    const Card = (operatorUi as Record<string, unknown>)["Card"];
    const CardHeader = (operatorUi as Record<string, unknown>)["CardHeader"];
    const CardContent = (operatorUi as Record<string, unknown>)["CardContent"];
    const CardFooter = (operatorUi as Record<string, unknown>)["CardFooter"];

    expect(Card).toBeDefined();
    expect(CardHeader).toBeDefined();
    expect(CardContent).toBeDefined();
    expect(CardFooter).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(
        Card as React.ComponentType,
        { className: "test-card" },
        React.createElement(
          CardHeader as React.ComponentType,
          { className: "test-header" },
          "Header",
        ),
        React.createElement(
          CardContent as React.ComponentType,
          { className: "test-content" },
          "Content",
        ),
        React.createElement(
          CardFooter as React.ComponentType,
          { className: "test-footer" },
          "Footer",
        ),
      ),
    );

    expect(container.querySelector(".test-card")?.className).toContain("bg-bg-card");
    expect(container.querySelector(".test-header")?.textContent).toBe("Header");
    expect(container.querySelector(".test-content")?.textContent).toBe("Content");
    expect(container.querySelector(".test-footer")?.textContent).toBe("Footer");

    cleanupTestRoot({ container, root });
  });
});
