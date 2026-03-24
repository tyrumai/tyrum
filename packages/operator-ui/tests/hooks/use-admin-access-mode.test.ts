// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdminAccessModeProvider,
  useAdminAccessMode,
} from "../../src/hooks/use-admin-access-mode.js";
import { cleanupTestRoot, renderIntoDocument, type TestRoot } from "../test-utils.js";

const STORAGE_KEY = "tyrum.adminAccessMode";

function ReadMode() {
  const { mode } = useAdminAccessMode();
  return React.createElement("div", { "data-testid": "mode", "data-mode": mode }, mode);
}

function ModeWithSetter() {
  const { hasStoredModePreference, mode, setMode } = useAdminAccessMode();
  return React.createElement(
    "div",
    null,
    React.createElement("span", { "data-testid": "mode", "data-mode": mode }, mode),
    React.createElement("span", {
      "data-testid": "stored-mode-preference",
      "data-value": String(hasStoredModePreference),
    }),
    React.createElement("button", {
      "data-testid": "set-always-on",
      onClick: () => setMode("always-on"),
    }),
    React.createElement("button", {
      "data-testid": "set-on-demand",
      onClick: () => setMode("on-demand"),
    }),
  );
}

describe("useAdminAccessMode", () => {
  let testRoot: TestRoot | null = null;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    if (testRoot) {
      cleanupTestRoot(testRoot);
      testRoot = null;
    }
    localStorage.clear();
  });

  it("defaults to on-demand when no stored value exists", () => {
    testRoot = renderIntoDocument(
      React.createElement(AdminAccessModeProvider, null, React.createElement(ReadMode)),
    );

    const modeEl = testRoot.container.querySelector('[data-testid="mode"]');
    expect(modeEl?.getAttribute("data-mode")).toBe("on-demand");
  });

  it("reads persisted value from localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "always-on");

    testRoot = renderIntoDocument(
      React.createElement(AdminAccessModeProvider, null, React.createElement(ReadMode)),
    );

    const modeEl = testRoot.container.querySelector('[data-testid="mode"]');
    expect(modeEl?.getAttribute("data-mode")).toBe("always-on");
  });

  it("falls back to on-demand for invalid localStorage values", () => {
    localStorage.setItem(STORAGE_KEY, "bogus");

    testRoot = renderIntoDocument(
      React.createElement(AdminAccessModeProvider, null, React.createElement(ReadMode)),
    );

    const modeEl = testRoot.container.querySelector('[data-testid="mode"]');
    expect(modeEl?.getAttribute("data-mode")).toBe("on-demand");
  });

  it("persists mode changes to localStorage", () => {
    testRoot = renderIntoDocument(
      React.createElement(AdminAccessModeProvider, null, React.createElement(ModeWithSetter)),
    );

    const btn = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="set-always-on"]',
    );
    act(() => {
      btn?.click();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe("always-on");
    const modeEl = testRoot.container.querySelector('[data-testid="mode"]');
    expect(modeEl?.getAttribute("data-mode")).toBe("always-on");
  });

  it("marks the mode preference as stored after the user chooses it", () => {
    testRoot = renderIntoDocument(
      React.createElement(AdminAccessModeProvider, null, React.createElement(ModeWithSetter)),
    );

    const storedElBefore = testRoot.container.querySelector(
      '[data-testid="stored-mode-preference"]',
    );
    expect(storedElBefore?.getAttribute("data-value")).toBe("false");

    const btn = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="set-always-on"]',
    );
    act(() => {
      btn?.click();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe("always-on");
    const storedElAfter = testRoot.container.querySelector(
      '[data-testid="stored-mode-preference"]',
    );
    expect(storedElAfter?.getAttribute("data-value")).toBe("true");
  });

  it("switches back to on-demand and persists", () => {
    localStorage.setItem(STORAGE_KEY, "always-on");

    testRoot = renderIntoDocument(
      React.createElement(AdminAccessModeProvider, null, React.createElement(ModeWithSetter)),
    );

    const btn = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="set-on-demand"]',
    );
    act(() => {
      btn?.click();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe("on-demand");
    const modeEl = testRoot.container.querySelector('[data-testid="mode"]');
    expect(modeEl?.getAttribute("data-mode")).toBe("on-demand");
  });

  it("throws when used outside AdminAccessModeProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => {
        renderIntoDocument(React.createElement(ReadMode));
      }).toThrow("useAdminAccessMode must be used within an AdminAccessModeProvider.");
    } finally {
      spy.mockRestore();
    }
  });
});
