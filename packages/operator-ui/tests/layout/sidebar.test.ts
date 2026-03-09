// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { LayoutDashboard, ShieldCheck } from "lucide-react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

function stubLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
}

describe("Sidebar", () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (typeof localStorage !== "undefined" && typeof localStorage.removeItem === "function") {
      localStorage.removeItem("tyrum-sidebar-collapsed");
      localStorage.removeItem("tyrum-sidebar-secondary-collapsed");
    }
  });

  it("renders nav items and connection indicator without a brand row", () => {
    const ThemeProvider = (operatorUi as Record<string, unknown>)["ThemeProvider"];
    const Sidebar = (operatorUi as Record<string, unknown>)["Sidebar"];

    expect(ThemeProvider).toBeDefined();
    expect(Sidebar).toBeDefined();

    const onNavigate = vi.fn();

    const { container, root } = renderIntoDocument(
      React.createElement(
        ThemeProvider as React.ComponentType,
        null,
        React.createElement(Sidebar as React.ComponentType, {
          items: [
            { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
            { id: "approvals", label: "Approvals", icon: ShieldCheck, testId: "nav-approvals" },
          ],
          activeItemId: "approvals",
          onNavigate,
          connectionStatus: "connected",
        }),
      ),
    );

    expect(container.textContent).not.toContain("Tyrum");
    expect(container.textContent).toContain("Dashboard");
    expect(container.textContent).toContain("Approvals");

    const active = container.querySelector("[data-testid='nav-approvals']");
    expect(active?.getAttribute("data-active")).toBe("true");
    expect(active?.className).toContain("border-border");
    expect(
      container.querySelector("[data-testid='nav-approvals-active-indicator']"),
    ).not.toBeNull();

    const statusControls = container.querySelector("[data-testid='sidebar-status-controls']");
    expect(statusControls).not.toBeNull();
    expect(statusControls?.className).toContain("justify-start");

    const dot = container.querySelector<HTMLSpanElement>("[data-testid='connection-status-dot']");
    const statusLabel = container.querySelector<HTMLSpanElement>(
      "[data-testid='connection-status-label']",
    );
    expect(dot).not.toBeNull();
    expect(statusLabel).not.toBeNull();
    expect(statusLabel?.textContent).toBe("Connected");
    expect(dot?.className).toContain("bg-success");
    expect(statusControls?.contains(dot as Node)).toBe(true);
    expect(container.querySelector("[data-testid='sidebar-theme-group']")).toBeNull();
    expect(container.querySelector("[data-testid='theme-toggle']")).toBeNull();

    cleanupTestRoot({ container, root });
  });

  it("shows a red status dot when disconnected", () => {
    const ThemeProvider = (operatorUi as Record<string, unknown>)["ThemeProvider"];
    const Sidebar = (operatorUi as Record<string, unknown>)["Sidebar"];

    const { container, root } = renderIntoDocument(
      React.createElement(
        ThemeProvider as React.ComponentType,
        null,
        React.createElement(Sidebar as React.ComponentType, {
          items: [
            { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
          ],
          activeItemId: "dashboard",
          onNavigate: vi.fn(),
          connectionStatus: "disconnected",
        }),
      ),
    );

    const dot = container.querySelector<HTMLSpanElement>("[data-testid='connection-status-dot']");
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain("bg-error");

    cleanupTestRoot({ container, root });
  });

  it("shows an orange pulsing status dot when connecting", () => {
    const ThemeProvider = (operatorUi as Record<string, unknown>)["ThemeProvider"];
    const Sidebar = (operatorUi as Record<string, unknown>)["Sidebar"];

    const { container, root } = renderIntoDocument(
      React.createElement(
        ThemeProvider as React.ComponentType,
        null,
        React.createElement(Sidebar as React.ComponentType, {
          items: [
            { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
          ],
          activeItemId: "dashboard",
          onNavigate: vi.fn(),
          connectionStatus: "connecting",
        }),
      ),
    );

    const dot = container.querySelector<HTMLSpanElement>("[data-testid='connection-status-dot']");
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain("bg-warning");
    expect(dot?.className).toContain("animate-pulse");

    cleanupTestRoot({ container, root });
  });

  it("keeps the status area centered and dot-only while collapsed", () => {
    const ThemeProvider = (operatorUi as Record<string, unknown>)["ThemeProvider"];
    const Sidebar = (operatorUi as Record<string, unknown>)["Sidebar"];

    const { container, root } = renderIntoDocument(
      React.createElement(
        ThemeProvider as React.ComponentType,
        null,
        React.createElement(Sidebar as React.ComponentType, {
          items: [
            { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
          ],
          activeItemId: "dashboard",
          onNavigate: vi.fn(),
          collapsible: true,
          connectionStatus: "connected",
        }),
      ),
    );

    const collapseToggle = container.querySelector<HTMLButtonElement>(
      "[data-testid='sidebar-collapse-toggle']",
    );
    expect(collapseToggle).not.toBeNull();
    act(() => {
      collapseToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const statusControls = container.querySelector<HTMLDivElement>(
      "[data-testid='sidebar-status-controls']",
    );
    expect(statusControls).not.toBeNull();
    expect(statusControls?.className).toContain("justify-center");
    expect(container.querySelector("[data-testid='connection-status-label']")).toBeNull();

    const dot = container.querySelector<HTMLSpanElement>("[data-testid='connection-status-dot']");
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain("bg-success");

    cleanupTestRoot({ container, root });
  });

  it("renders a sync-now button when provided", () => {
    const ThemeProvider = (operatorUi as Record<string, unknown>)["ThemeProvider"];
    const Sidebar = (operatorUi as Record<string, unknown>)["Sidebar"];

    const onSyncNow = vi.fn();

    const { container, root } = renderIntoDocument(
      React.createElement(
        ThemeProvider as React.ComponentType,
        null,
        React.createElement(Sidebar as React.ComponentType, {
          items: [
            { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
          ],
          activeItemId: "dashboard",
          onNavigate: vi.fn(),
          connectionStatus: "connected",
          onSyncNow,
        }),
      ),
    );

    const syncButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='sidebar-sync-now']",
    );
    expect(syncButton).not.toBeNull();

    act(() => {
      syncButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSyncNow).toHaveBeenCalledTimes(1);

    cleanupTestRoot({ container, root });
  });

  it("uses a shared expanded row layout for nav and footer items", () => {
    const ThemeProvider = (operatorUi as Record<string, unknown>)["ThemeProvider"];
    const Sidebar = (operatorUi as Record<string, unknown>)["Sidebar"];

    const { container, root } = renderIntoDocument(
      React.createElement(
        ThemeProvider as React.ComponentType,
        null,
        React.createElement(Sidebar as React.ComponentType, {
          items: [
            {
              id: "dashboard",
              label: "Dashboard",
              icon: LayoutDashboard,
              testId: "nav-dashboard",
              badgeCount: 1,
            },
          ],
          activeItemId: "dashboard",
          onNavigate: vi.fn(),
          secondaryItems: [{ id: "approvals", label: "Approvals", icon: ShieldCheck }],
          secondaryLabel: "Platform",
          secondaryCollapsible: true,
          connectionStatus: "connected",
          onSyncNow: vi.fn(),
          collapsible: true,
        }),
      ),
    );

    const expectedLayoutClass = "grid-cols-[1rem_minmax(0,1fr)_auto]";
    expect(
      container.querySelector<HTMLButtonElement>("[data-testid='nav-dashboard']")?.className,
    ).toContain(expectedLayoutClass);
    expect(
      container.querySelector<HTMLButtonElement>("[data-testid='sidebar-secondary-toggle']")
        ?.className,
    ).toContain(expectedLayoutClass);
    expect(
      container.querySelector<HTMLButtonElement>("[data-testid='sidebar-sync-now']")?.className,
    ).toContain(expectedLayoutClass);
    expect(
      container.querySelector<HTMLButtonElement>("[data-testid='sidebar-collapse-toggle']")
        ?.className,
    ).toContain(expectedLayoutClass);

    cleanupTestRoot({ container, root });
  });

  it("disables sync-now when requested", () => {
    const ThemeProvider = (operatorUi as Record<string, unknown>)["ThemeProvider"];
    const Sidebar = (operatorUi as Record<string, unknown>)["Sidebar"];

    const { container, root } = renderIntoDocument(
      React.createElement(
        ThemeProvider as React.ComponentType,
        null,
        React.createElement(Sidebar as React.ComponentType, {
          items: [
            { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
          ],
          activeItemId: "dashboard",
          onNavigate: vi.fn(),
          connectionStatus: "disconnected",
          onSyncNow: vi.fn(),
          syncNowDisabled: true,
        }),
      ),
    );

    const syncButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='sidebar-sync-now']",
    );
    expect(syncButton).not.toBeNull();
    expect(syncButton?.disabled).toBe(true);

    cleanupTestRoot({ container, root });
  });
});
