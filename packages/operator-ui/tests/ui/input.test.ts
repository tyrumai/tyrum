// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Input", () => {
  it("renders label + helper text", () => {
    const Input = (operatorUi as Record<string, unknown>)["Input"];
    expect(Input).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(Input as React.ComponentType, {
        id: "name",
        label: "Name",
        helperText: "Shown on your profile",
        className: "test-input",
      }),
    );

    const label = container.querySelector("label");
    expect(label?.textContent).toContain("Name");

    const input = container.querySelector("input#name");
    expect(input).not.toBeNull();
    expect(container.textContent).toContain("Shown on your profile");

    cleanupTestRoot({ container, root });
  });

  it("supports error state", () => {
    const Input = (operatorUi as Record<string, unknown>)["Input"];
    expect(Input).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(Input as React.ComponentType, {
        id: "token",
        label: "Token",
        error: "Token is required",
      }),
    );

    const input = container.querySelector("input#token");
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain("Token is required");

    cleanupTestRoot({ container, root });
  });

  it("limits transitions to border and ring styles", () => {
    const Input = (operatorUi as Record<string, unknown>)["Input"];
    expect(Input).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(Input as React.ComponentType, {
        id: "focus-target",
        label: "Focus target",
      }),
    );

    const input = container.querySelector<HTMLInputElement>("input#focus-target");
    expect(input).not.toBeNull();
    expect(input?.className).toContain("transition-[border-color,box-shadow]");
    expect(input?.className).not.toContain("transition-colors");

    cleanupTestRoot({ container, root });
  });

  it("renders helper text when error is an empty string", () => {
    const Input = (operatorUi as Record<string, unknown>)["Input"];
    expect(Input).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(Input as React.ComponentType, {
        id: "email",
        label: "Email",
        helperText: "We never share your email",
        error: "",
      }),
    );

    const input = container.querySelector("input#email");
    expect(input?.getAttribute("aria-invalid")).not.toBe("true");
    expect(input?.getAttribute("aria-describedby")).toBe("email-help");

    const helper = container.querySelector("#email-help");
    expect(helper).not.toBeNull();
    expect(helper?.textContent).toContain("We never share your email");

    cleanupTestRoot({ container, root });
  });
});
