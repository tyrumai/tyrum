// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { AppShell } from "../../src/index.js";
import { useAppShellMinWidth } from "../../src/components/layout/app-shell.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("AppShell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("supports fullBleed content without forwarding props to the DOM", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container, root } = renderIntoDocument(
      React.createElement(
        AppShell as React.ComponentType,
        {
          mode: "desktop",
          fullBleed: true,
          sidebar: React.createElement("div", { "data-testid": "sidebar" }),
          mobileNav: null,
        },
        React.createElement("div", { "data-testid": "content" }),
      ),
    );

    expect(consoleError).not.toHaveBeenCalled();
    expect(container.querySelector(".mx-auto")).toBeNull();

    cleanupTestRoot({ container, root });
  });

  it.each([
    { mode: "desktop", expectedHeightClass: "h-screen" },
    { mode: "web", expectedHeightClass: "h-dvh" },
  ] as const)(
    "supports viewportLocked content in $mode mode without forwarding props to the DOM",
    ({ mode, expectedHeightClass }) => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      const { container, root } = renderIntoDocument(
        React.createElement(
          AppShell as React.ComponentType,
          {
            mode,
            viewportLocked: true,
            sidebar: React.createElement("div", { "data-testid": "sidebar" }),
            mobileNav: React.createElement("div", { "data-testid": "mobile-nav" }),
          },
          React.createElement("div", { "data-testid": "content" }),
        ),
      );

      const outer = container.firstElementChild as HTMLDivElement | null;
      const main = container.querySelector("main");
      const contentWrapper = container.querySelector("main > div");

      expect(consoleError).not.toHaveBeenCalled();
      expect(outer?.className).toContain(expectedHeightClass);
      expect(main?.className).toContain("min-h-0");
      expect(main?.className).toContain("overflow-y-hidden");
      expect(contentWrapper?.className).toContain("h-full");
      expect(contentWrapper?.className).toContain("min-h-0");
      expect(contentWrapper?.className).toContain("flex");
      expect(contentWrapper?.className).toContain("flex-col");
      expect(contentWrapper?.className).toContain("overflow-hidden");

      cleanupTestRoot({ container, root });
    },
  );

  it("measures content width with content-box semantics before resize events", () => {
    const originalMatchMedia = globalThis.matchMedia;
    const originalResizeObserver = globalThis.ResizeObserver;
    let resizeObserverCallback: ResizeObserverCallback | null = null;
    let observedElement: Element | null = null;

    globalThis.matchMedia = vi.fn((query: string) => {
      const matches = query === "(min-width: 768px)";
      return {
        matches,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      } as MediaQueryList;
    });

    const isMeasuredElement = (element: unknown): element is HTMLElement => {
      return (
        element instanceof HTMLElement &&
        typeof element.className === "string" &&
        element.className.includes("min-w-0 flex-1 flex-col overflow-hidden")
      );
    };

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

    vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element) => {
      return {
        paddingLeft: isMeasuredElement(element) ? "24px" : "0px",
        paddingRight: isMeasuredElement(element) ? "24px" : "0px",
      } as CSSStyleDeclaration;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return isMeasuredElement(this) ? 300 : 0;
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      return {
        width: isMeasuredElement(this) ? 300 : 0,
        height: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    function WidthProbe() {
      return React.createElement(
        "div",
        { "data-testid": "probe" },
        useAppShellMinWidth(280) ? "wide" : "narrow",
      );
    }

    let testRoot: ReturnType<typeof renderIntoDocument> | null = null;
    try {
      testRoot = renderIntoDocument(
        React.createElement(
          AppShell,
          {
            mode: "desktop",
            sidebar: React.createElement("div"),
            mobileNav: null,
          },
          React.createElement(WidthProbe),
        ),
      );

      const probe = testRoot.container.querySelector("[data-testid='probe']");
      expect(probe?.textContent).toBe("narrow");
      expect(observedElement).toBeInstanceOf(HTMLElement);
      expect(resizeObserverCallback).not.toBeNull();

      act(() => {
        resizeObserverCallback?.(
          [
            {
              target: observedElement as Element,
              contentRect: { width: 252 } as DOMRectReadOnly,
            } as ResizeObserverEntry,
          ],
          {} as ResizeObserver,
        );
      });

      expect(probe?.textContent).toBe("narrow");
    } finally {
      if (testRoot) {
        cleanupTestRoot(testRoot);
      }
      globalThis.matchMedia = originalMatchMedia;
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });
});
