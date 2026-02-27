// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Tooltip", () => {
  it("renders tooltip content with an arrow when open", () => {
    const TooltipProvider = (operatorUi as Record<string, unknown>)["TooltipProvider"];
    const Tooltip = (operatorUi as Record<string, unknown>)["Tooltip"];
    const TooltipTrigger = (operatorUi as Record<string, unknown>)["TooltipTrigger"];
    const TooltipContent = (operatorUi as Record<string, unknown>)["TooltipContent"];

    expect(TooltipProvider).toBeDefined();
    expect(Tooltip).toBeDefined();
    expect(TooltipTrigger).toBeDefined();
    expect(TooltipContent).toBeDefined();

    const { root, container } = renderIntoDocument(
      React.createElement(
        TooltipProvider as React.ComponentType,
        { delayDuration: 0 },
        React.createElement(
          Tooltip as React.ComponentType,
          { open: true, onOpenChange: () => {} },
          React.createElement(
            TooltipTrigger as React.ComponentType,
            { asChild: true },
            React.createElement("button", { className: "test-trigger" }, "Trigger"),
          ),
          React.createElement(
            TooltipContent as React.ComponentType,
            { className: "test-tooltip" },
            "Hello",
          ),
        ),
      ),
    );

    expect(container.querySelector("button.test-trigger")).not.toBeNull();

    const content = document.body.querySelector(".test-tooltip");
    expect(content?.textContent).toContain("Hello");

    const arrow = document.body.querySelector("[data-tooltip-arrow]");
    expect(arrow).not.toBeNull();

    cleanupTestRoot({ root, container });
  });
});
