// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Alert", () => {
  it("renders title + description with an icon", () => {
    const Alert = (operatorUi as Record<string, unknown>)["Alert"];
    expect(Alert).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(Alert as React.ComponentType, {
        title: "Saved",
        description: "All good",
      }),
    );

    const el = container.querySelector('[role="alert"]');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("Saved");
    expect(el?.textContent).toContain("All good");
    expect(el?.querySelector("svg")).not.toBeNull();

    cleanupTestRoot({ container, root });
  });

  it("supports variants", () => {
    const Alert = (operatorUi as Record<string, unknown>)["Alert"];
    expect(Alert).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(Alert as React.ComponentType, {
        variant: "error",
        title: "Nope",
        description: "Try again",
        className: "test-alert",
      }),
    );

    const el = container.querySelector(".test-alert");
    expect(el).not.toBeNull();
    expect(el?.className).toContain("border-error");

    cleanupTestRoot({ container, root });
  });
});
