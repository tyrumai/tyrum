// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("ScrollArea", () => {
  it("renders viewport and scrollbar thumb", () => {
    const ScrollArea = (operatorUi as Record<string, unknown>)["ScrollArea"];
    expect(ScrollArea).toBeDefined();

    const { root, container } = renderIntoDocument(
      React.createElement(
        ScrollArea as React.ComponentType,
        { className: "test-scroll-area", type: "always" },
        React.createElement("div", { className: "scroll-content" }, "Content"),
      ),
    );

    const viewport = container.querySelector("[data-scroll-area-viewport]");
    expect(viewport?.querySelector(".scroll-content")?.textContent).toContain("Content");

    const thumb = container.querySelector("[data-scroll-area-thumb]");
    expect(thumb).not.toBeNull();

    cleanupTestRoot({ root, container });
  });

  it("forwards onScroll to the scroll viewport", () => {
    const ScrollArea = (operatorUi as Record<string, unknown>)["ScrollArea"];
    expect(ScrollArea).toBeDefined();

    const onScroll = vi.fn();
    const { root, container } = renderIntoDocument(
      React.createElement(
        ScrollArea as React.ComponentType,
        { className: "test-scroll-area", type: "always", onScroll },
        React.createElement("div", { className: "scroll-content" }, "Content"),
      ),
    );

    const viewport = container.querySelector("[data-scroll-area-viewport]");
    expect(viewport).not.toBeNull();

    viewport?.dispatchEvent(new Event("scroll"));
    expect(onScroll).toHaveBeenCalledTimes(1);

    cleanupTestRoot({ root, container });
  });
});
