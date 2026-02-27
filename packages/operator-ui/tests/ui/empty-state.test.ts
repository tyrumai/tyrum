// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import { CircleX } from "lucide-react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("EmptyState", () => {
  it("renders title, description, and optional action", () => {
    const EmptyState = (operatorUi as Record<string, unknown>)["EmptyState"];
    expect(EmptyState).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(EmptyState as React.ComponentType, {
        icon: CircleX,
        title: "Nothing here",
        description: "Try creating something first.",
        action: { label: "Create", onClick: () => {} },
      }),
    );

    expect(container.textContent).toContain("Nothing here");
    expect(container.textContent).toContain("Try creating something first.");

    const button = Array.from(container.querySelectorAll("button")).find((node) =>
      (node.textContent ?? "").includes("Create"),
    );
    expect(button).toBeDefined();

    cleanupTestRoot({ container, root });
  });
});
