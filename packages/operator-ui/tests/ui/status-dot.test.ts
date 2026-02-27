// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("StatusDot", () => {
  it("supports variants and pulse animation", () => {
    const StatusDot = (operatorUi as Record<string, unknown>)["StatusDot"];
    expect(StatusDot).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(StatusDot as React.ComponentType, {
        variant: "success",
        pulse: true,
        className: "test-dot",
      }),
    );

    const el = container.querySelector(".test-dot");
    expect(el).not.toBeNull();
    expect(el?.className).toContain("bg-success");
    expect(el?.className).toContain("animate-pulse");

    cleanupTestRoot({ container, root });
  });
});
