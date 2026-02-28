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
});
