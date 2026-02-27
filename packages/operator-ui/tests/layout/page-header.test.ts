// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("PageHeader", () => {
  it("renders title, breadcrumbs, and actions", () => {
    const PageHeader = (operatorUi as Record<string, unknown>)["PageHeader"];
    expect(PageHeader).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(PageHeader as React.ComponentType, {
        title: "Approvals",
        breadcrumbs: React.createElement("div", null, "Dashboard / Approvals"),
        actions: React.createElement("button", { type: "button" }, "Refresh"),
      }),
    );

    expect(container.textContent).toContain("Approvals");
    expect(container.textContent).toContain("Dashboard / Approvals");
    expect(container.textContent).toContain("Refresh");

    cleanupTestRoot({ container, root });
  });
});

