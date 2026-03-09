// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { ElevatedModeTooltip } from "../../src/components/elevated-mode/elevated-mode-tooltip.js";
import { Button } from "../../src/components/ui/button.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("ElevatedModeTooltip", () => {
  it("avoids double-dimming disabled descendants while elevated mode is locked", () => {
    const requestEnter = vi.fn();

    const { root, container } = renderIntoDocument(
      React.createElement(
        ElevatedModeTooltip,
        { canMutate: false, requestEnter },
        React.createElement(
          "div",
          { className: "flex gap-2" },
          React.createElement(Button, { type: "button" }, "Issue token"),
          React.createElement(Button, { type: "button", disabled: true }, "Revoke token"),
        ),
      ),
    );

    const guard = container.querySelector("[data-elevated-mode-guard]");
    expect(guard).not.toBeNull();

    const mutedContent = guard?.firstElementChild;
    expect(mutedContent).not.toBeNull();
    expect(mutedContent?.className).toContain("opacity-50");
    expect(mutedContent?.className).toContain("[&_:disabled]:!opacity-100");

    const buttons = guard?.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons?.[1]?.hasAttribute("disabled")).toBe(true);

    cleanupTestRoot({ root, container });
  });
});
