// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("AppShell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("supports fullBleed content without forwarding props to the DOM", () => {
    const AppShell = (operatorUi as Record<string, unknown>)["AppShell"];
    expect(AppShell).toBeDefined();

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
      const AppShell = (operatorUi as Record<string, unknown>)["AppShell"];
      expect(AppShell).toBeDefined();

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
});
