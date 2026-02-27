// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("DropdownMenu", () => {
  it("renders content, items, and a separator when open", () => {
    const DropdownMenu = (operatorUi as Record<string, unknown>)["DropdownMenu"];
    const DropdownMenuTrigger = (operatorUi as Record<string, unknown>)["DropdownMenuTrigger"];
    const DropdownMenuContent = (operatorUi as Record<string, unknown>)["DropdownMenuContent"];
    const DropdownMenuItem = (operatorUi as Record<string, unknown>)["DropdownMenuItem"];
    const DropdownMenuSeparator = (operatorUi as Record<string, unknown>)["DropdownMenuSeparator"];

    expect(DropdownMenu).toBeDefined();
    expect(DropdownMenuTrigger).toBeDefined();
    expect(DropdownMenuContent).toBeDefined();
    expect(DropdownMenuItem).toBeDefined();
    expect(DropdownMenuSeparator).toBeDefined();

    const { root, container } = renderIntoDocument(
      React.createElement(
        DropdownMenu as React.ComponentType,
        { open: true, onOpenChange: () => {} },
        React.createElement(
          DropdownMenuTrigger as React.ComponentType,
          { asChild: true },
          React.createElement("button", { className: "test-trigger" }, "Menu"),
        ),
        React.createElement(
          DropdownMenuContent as React.ComponentType,
          { className: "test-menu" },
          React.createElement(DropdownMenuItem as React.ComponentType, null, "Item 1"),
          React.createElement(DropdownMenuSeparator as React.ComponentType, null),
          React.createElement(DropdownMenuItem as React.ComponentType, null, "Item 2"),
        ),
      ),
    );

    expect(container.querySelector("button.test-trigger")).not.toBeNull();

    const content = document.body.querySelector(".test-menu");
    expect(content?.textContent).toContain("Item 1");
    expect(content?.textContent).toContain("Item 2");
    expect(content?.querySelector("[role='separator']")).not.toBeNull();

    cleanupTestRoot({ root, container });
  });
});
