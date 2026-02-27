// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Skeleton", () => {
  it("renders an animated placeholder with configurable dimensions", () => {
    const Skeleton = (operatorUi as Record<string, unknown>)["Skeleton"];
    expect(Skeleton).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(Skeleton as React.ComponentType, {
        width: 120,
        height: "2rem",
        className: "test-skeleton",
      }),
    );

    const skeleton = container.querySelector(".test-skeleton") as HTMLDivElement | null;
    expect(skeleton).not.toBeNull();
    expect(skeleton?.classList.contains("animate-pulse")).toBe(true);
    expect(skeleton?.style.width).toBe("120px");
    expect(skeleton?.style.height).toBe("2rem");

    cleanupTestRoot({ container, root });
  });
});
