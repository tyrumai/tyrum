// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Textarea", () => {
  it("renders label and textarea", () => {
    const Textarea = (operatorUi as Record<string, unknown>)["Textarea"];
    expect(Textarea).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(Textarea as React.ComponentType, {
        id: "notes",
        label: "Notes",
        helperText: "Add more context",
      }),
    );

    expect(container.querySelector("label")?.textContent).toContain("Notes");
    expect(container.querySelector("textarea#notes")).not.toBeNull();
    expect(container.textContent).toContain("Add more context");

    cleanupTestRoot({ container, root });
  });

  it("supports error state", () => {
    const Textarea = (operatorUi as Record<string, unknown>)["Textarea"];
    expect(Textarea).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(Textarea as React.ComponentType, {
        id: "notes",
        label: "Notes",
        error: "Notes are required",
      }),
    );

    const textarea = container.querySelector("textarea#notes");
    expect(textarea?.getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain("Notes are required");

    cleanupTestRoot({ container, root });
  });

  it("limits transitions to border and ring styles", () => {
    const Textarea = (operatorUi as Record<string, unknown>)["Textarea"];
    expect(Textarea).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(Textarea as React.ComponentType, {
        id: "focus-target",
        label: "Focus target",
      }),
    );

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea#focus-target");
    expect(textarea).not.toBeNull();
    expect(textarea?.className).toContain("transition-[border-color,box-shadow]");
    expect(textarea?.className).not.toContain("transition-colors");

    cleanupTestRoot({ container, root });
  });

  it("renders helper text when error is an empty string", () => {
    const Textarea = (operatorUi as Record<string, unknown>)["Textarea"];
    expect(Textarea).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(Textarea as React.ComponentType, {
        id: "bio",
        label: "Bio",
        helperText: "Tell us a bit about yourself",
        error: "",
      }),
    );

    const textarea = container.querySelector("textarea#bio");
    expect(textarea?.getAttribute("aria-invalid")).not.toBe("true");
    expect(textarea?.getAttribute("aria-describedby")).toBe("bio-help");

    const helper = container.querySelector("#bio-help");
    expect(helper).not.toBeNull();
    expect(helper?.textContent).toContain("Tell us a bit about yourself");

    cleanupTestRoot({ container, root });
  });
});
