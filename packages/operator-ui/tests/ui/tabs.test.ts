// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Tabs", () => {
  it("renders triggers and shows the active content", () => {
    const Tabs = (operatorUi as Record<string, unknown>)["Tabs"];
    const TabsList = (operatorUi as Record<string, unknown>)["TabsList"];
    const TabsTrigger = (operatorUi as Record<string, unknown>)["TabsTrigger"];
    const TabsContent = (operatorUi as Record<string, unknown>)["TabsContent"];

    expect(Tabs).toBeDefined();
    expect(TabsList).toBeDefined();
    expect(TabsTrigger).toBeDefined();
    expect(TabsContent).toBeDefined();

    const { root, container } = renderIntoDocument(
      React.createElement(
        Tabs as React.ComponentType,
        { defaultValue: "account" },
        React.createElement(
          TabsList as React.ComponentType,
          null,
          React.createElement(TabsTrigger as React.ComponentType, { value: "account" }, "Account"),
          React.createElement(
            TabsTrigger as React.ComponentType,
            { value: "password" },
            "Password",
          ),
        ),
        React.createElement(
          TabsContent as React.ComponentType,
          { value: "account" },
          "Account content",
        ),
        React.createElement(
          TabsContent as React.ComponentType,
          { value: "password" },
          "Password content",
        ),
      ),
    );

    const activeTrigger = container.querySelector("[data-state='active'][role='tab']");
    expect(activeTrigger?.textContent).toContain("Account");

    const activePanel = container.querySelector("[data-state='active'][role='tabpanel']");
    expect(activePanel?.textContent).toContain("Account content");
    expect((activePanel as HTMLElement | null)?.className).toContain("min-w-0");

    const triggers = Array.from(container.querySelectorAll("[role='tab']")).map(
      (el) => el.textContent,
    );
    expect(triggers.join(" ")).toContain("Password");

    cleanupTestRoot({ root, container });
  });
});
