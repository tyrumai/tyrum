// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { LayoutDashboard, MessageSquare, ShieldCheck, SquareKanban } from "lucide-react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("MobileNav", () => {
  const items = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
    { id: "chat", label: "Chat", icon: MessageSquare, testId: "nav-chat" },
    { id: "approvals", label: "Approvals", icon: ShieldCheck, testId: "nav-approvals" },
    { id: "workboard", label: "Work", icon: SquareKanban, testId: "nav-workboard" },
  ];

  it("renders primary tabs and a More overflow trigger", () => {
    const MobileNav = (operatorUi as Record<string, unknown>)["MobileNav"];
    expect(MobileNav).toBeDefined();

    const onNavigate = vi.fn();

    const { container, root } = renderIntoDocument(
      React.createElement(MobileNav as React.ComponentType, {
        items,
        overflowItems: [],
        activeItemId: "workboard",
        onNavigate,
      }),
    );

    const tabs = container.querySelectorAll("button[data-testid^='nav-']");
    expect(tabs.length).toBe(5);

    const active = container.querySelector("[data-testid='nav-workboard']");
    expect(active?.getAttribute("data-active")).toBe("true");

    const dashboard = container.querySelector<HTMLButtonElement>("[data-testid='nav-dashboard']");
    expect(dashboard).not.toBeNull();
    expect(dashboard?.className).toContain("focus-visible:ring-2");
    expect(dashboard?.className).toContain("focus-visible:ring-focus-ring");

    const more = container.querySelector("[data-testid='nav-more']");
    expect(more).not.toBeNull();

    cleanupTestRoot({ container, root });
  });

  it("uses a z-index below legacy admin dialogs", () => {
    const MobileNav = (operatorUi as Record<string, unknown>)["MobileNav"];
    expect(MobileNav).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(MobileNav as React.ComponentType, {
        items,
        overflowItems: [],
        activeItemId: "workboard",
        onNavigate: vi.fn(),
      }),
    );

    const nav = container.querySelector("nav");
    expect(nav).not.toBeNull();
    expect(nav?.className).toContain("z-40");
    expect(nav?.className).not.toContain("z-50");

    cleanupTestRoot({ container, root });
  });
});
