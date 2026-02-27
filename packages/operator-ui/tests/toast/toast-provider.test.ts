// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("ToastProvider", () => {
  it("renders children and exposes toast helpers", () => {
    const ThemeProvider = (operatorUi as Record<string, unknown>)["ThemeProvider"];
    const ToastProvider = (operatorUi as Record<string, unknown>)["ToastProvider"];
    const toast = (operatorUi as Record<string, unknown>)["toast"] as
      | Record<string, unknown>
      | undefined;

    expect(ThemeProvider).toBeDefined();
    expect(ToastProvider).toBeDefined();
    expect(toast).toBeDefined();

    expect(typeof toast?.["success"]).toBe("function");
    expect(typeof toast?.["error"]).toBe("function");
    expect(typeof toast?.["promise"]).toBe("function");

    const { container, root } = renderIntoDocument(
      React.createElement(
        ThemeProvider as React.ComponentType<{ children: React.ReactNode }>,
        null,
        React.createElement(
          ToastProvider as React.ComponentType<{ children: React.ReactNode }>,
          null,
          React.createElement("div", { "data-testid": "child" }, "child"),
        ),
      ),
    );

    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();

    cleanupTestRoot({ container, root });
  });

  it("renders without ThemeProvider", () => {
    const ToastProvider = (operatorUi as Record<string, unknown>)["ToastProvider"];
    expect(ToastProvider).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(
        ToastProvider as React.ComponentType<{ children: React.ReactNode }>,
        null,
        React.createElement("div", { "data-testid": "child" }, "child"),
      ),
    );

    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();

    cleanupTestRoot({ container, root });
  });
});
