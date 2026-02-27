// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument, stubMatchMedia } from "../test-utils.js";

describe("AppShell", () => {
  it("renders the sidebar in desktop mode regardless of breakpoint", () => {
    const AppShell = (operatorUi as Record<string, unknown>)["AppShell"];
    expect(AppShell).toBeDefined();

    const matchMedia = stubMatchMedia("(min-width: 768px)", false);

    const { container, root } = renderIntoDocument(
      React.createElement(
        AppShell as React.ComponentType,
        {
          mode: "desktop",
          sidebar: React.createElement("div", null, "Sidebar"),
          mobileNav: React.createElement("div", null, "MobileNav"),
        },
        React.createElement("div", null, "Content"),
      ),
    );

    expect(container.textContent).toContain("Sidebar");
    expect(container.textContent).not.toContain("MobileNav");

    const main = container.querySelector("main");
    expect(main?.className).toContain("overflow-y-auto");

    cleanupTestRoot({ container, root });
    matchMedia.cleanup();
  });

  it("renders MobileNav on web below md breakpoint", () => {
    const AppShell = (operatorUi as Record<string, unknown>)["AppShell"];
    expect(AppShell).toBeDefined();

    const matchMedia = stubMatchMedia("(min-width: 768px)", false);

    const { container, root } = renderIntoDocument(
      React.createElement(
        AppShell as React.ComponentType,
        {
          mode: "web",
          sidebar: React.createElement("div", null, "Sidebar"),
          mobileNav: React.createElement("div", null, "MobileNav"),
        },
        React.createElement("div", null, "Content"),
      ),
    );

    expect(container.textContent).not.toContain("Sidebar");
    expect(container.textContent).toContain("MobileNav");

    cleanupTestRoot({ container, root });
    matchMedia.cleanup();
  });

  it("renders the sidebar on web at md breakpoint and above", () => {
    const AppShell = (operatorUi as Record<string, unknown>)["AppShell"];
    expect(AppShell).toBeDefined();

    const matchMedia = stubMatchMedia("(min-width: 768px)", true);

    const { container, root } = renderIntoDocument(
      React.createElement(
        AppShell as React.ComponentType,
        {
          mode: "web",
          sidebar: React.createElement("div", null, "Sidebar"),
          mobileNav: React.createElement("div", null, "MobileNav"),
        },
        React.createElement("div", null, "Content"),
      ),
    );

    expect(container.textContent).toContain("Sidebar");
    expect(container.textContent).not.toContain("MobileNav");

    cleanupTestRoot({ container, root });
    matchMedia.cleanup();
  });
});
