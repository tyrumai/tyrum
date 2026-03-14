// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { AppPageContent } from "../../src/components/layout/app-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

function isLayoutContentElement(element: unknown): element is HTMLElement {
  return element instanceof HTMLElement && element.hasAttribute("data-layout-content");
}

function installLayoutContentMeasurements(input: { clientWidth: number; scrollWidth: number }) {
  const originalResizeObserver = globalThis.ResizeObserver;
  let resizeObserverCallback: ResizeObserverCallback | null = null;
  let observedElement: Element | null = null;

  let clientWidth = input.clientWidth;
  let scrollWidth = input.scrollWidth;

  globalThis.ResizeObserver = class ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resizeObserverCallback = callback;
    }

    observe(target: Element): void {
      observedElement = target;
    }

    unobserve(_target: Element): void {}

    disconnect(): void {}
  };

  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return isLayoutContentElement(this) ? clientWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return isLayoutContentElement(this) ? scrollWidth : 0;
  });

  return {
    setWidths(next: { clientWidth?: number; scrollWidth?: number }) {
      if (typeof next.clientWidth === "number") {
        clientWidth = next.clientWidth;
      }
      if (typeof next.scrollWidth === "number") {
        scrollWidth = next.scrollWidth;
      }
    },
    notifyResize() {
      act(() => {
        resizeObserverCallback?.(
          [
            {
              target: observedElement as Element,
              contentRect: { width: clientWidth } as DOMRectReadOnly,
            } as ResizeObserverEntry,
          ],
          {} as ResizeObserver,
        );
      });
    },
    restore() {
      globalThis.ResizeObserver = originalResizeObserver;
    },
  };
}

describe("AppPageContent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("left aligns the content box while its children still overflow horizontally", () => {
    const measurements = installLayoutContentMeasurements({ clientWidth: 900, scrollWidth: 1200 });
    let testRoot: ReturnType<typeof renderIntoDocument> | null = null;

    try {
      testRoot = renderIntoDocument(
        React.createElement(
          AppPageContent,
          null,
          React.createElement("div", { style: { minWidth: "1200px" } }, "Wide content"),
        ),
      );

      const content = testRoot.container.querySelector("[data-layout-content]");
      expect(content?.getAttribute("data-layout-alignment")).toBe("start");
      expect(content?.className).toContain("ml-0");
      expect(content?.className).toContain("mr-auto");
      expect(content?.className).not.toContain("mx-auto");
    } finally {
      if (testRoot) {
        cleanupTestRoot(testRoot);
      }
      measurements.restore();
    }
  });

  it("recenters the content box after the overflow clears", () => {
    const measurements = installLayoutContentMeasurements({ clientWidth: 900, scrollWidth: 1200 });
    let testRoot: ReturnType<typeof renderIntoDocument> | null = null;

    try {
      testRoot = renderIntoDocument(
        React.createElement(
          AppPageContent,
          null,
          React.createElement("div", { style: { minWidth: "1200px" } }, "Wide content"),
        ),
      );

      measurements.setWidths({ scrollWidth: 900 });
      measurements.notifyResize();

      const content = testRoot.container.querySelector("[data-layout-content]");
      expect(content?.getAttribute("data-layout-alignment")).toBe("center");
      expect(content?.className).toContain("mx-auto");
      expect(content?.className).not.toContain("ml-0");
    } finally {
      if (testRoot) {
        cleanupTestRoot(testRoot);
      }
      measurements.restore();
    }
  });

  it("keeps stack layout as the default mode", () => {
    const measurements = installLayoutContentMeasurements({ clientWidth: 900, scrollWidth: 900 });
    let testRoot: ReturnType<typeof renderIntoDocument> | null = null;

    try {
      testRoot = renderIntoDocument(
        React.createElement(
          AppPageContent,
          null,
          React.createElement("div", null, "Document content"),
        ),
      );

      const content = testRoot.container.querySelector("[data-layout-content]");
      expect(content?.getAttribute("data-layout-mode")).toBe("stack");
      expect(content?.className).toContain("grid");
      expect(content?.className).toContain("min-h-fit");
      expect(content?.className).not.toContain("flex-col");
    } finally {
      if (testRoot) {
        cleanupTestRoot(testRoot);
      }
      measurements.restore();
    }
  });

  it("supports fill layout mode for viewport-constrained pages", () => {
    const measurements = installLayoutContentMeasurements({ clientWidth: 900, scrollWidth: 900 });
    let testRoot: ReturnType<typeof renderIntoDocument> | null = null;

    try {
      testRoot = renderIntoDocument(
        React.createElement(
          AppPageContent,
          { contentLayout: "fill" },
          React.createElement("div", null, "Constrained content"),
        ),
      );

      const content = testRoot.container.querySelector("[data-layout-content]");
      expect(content?.getAttribute("data-layout-mode")).toBe("fill");
      expect(content?.className).toContain("flex");
      expect(content?.className).toContain("flex-col");
      expect(content?.className).toContain("h-full");
      expect(content?.className).toContain("min-h-0");
      expect(content?.className).not.toContain("grid");
    } finally {
      if (testRoot) {
        cleanupTestRoot(testRoot);
      }
      measurements.restore();
    }
  });
});
