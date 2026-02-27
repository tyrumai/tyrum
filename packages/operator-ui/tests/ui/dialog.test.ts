// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Dialog", () => {
  it("does not apply translate(-50%, -50%) inside dialog keyframes (Tailwind v4)", () => {
    const css = readFileSync(join(process.cwd(), "packages/operator-ui/src/globals.css"), "utf8");

    const dialogInStart = css.indexOf("@keyframes tyrum-dialog-in");
    const dialogOutStart = css.indexOf("@keyframes tyrum-dialog-out");

    expect(dialogInStart).toBeGreaterThanOrEqual(0);
    expect(dialogOutStart).toBeGreaterThan(dialogInStart);

    const dialogInBlock = css.slice(dialogInStart, dialogOutStart);
    const dialogOutBlock = css.slice(dialogOutStart);

    expect(dialogInBlock).not.toContain("translate(-50%");
    expect(dialogOutBlock).not.toContain("translate(-50%");
  });

  it("renders overlay/content and a close button when open", () => {
    const Dialog = (operatorUi as Record<string, unknown>)["Dialog"];
    const DialogContent = (operatorUi as Record<string, unknown>)["DialogContent"];
    const DialogHeader = (operatorUi as Record<string, unknown>)["DialogHeader"];
    const DialogFooter = (operatorUi as Record<string, unknown>)["DialogFooter"];
    const DialogTitle = (operatorUi as Record<string, unknown>)["DialogTitle"];

    expect(Dialog).toBeDefined();
    expect(DialogContent).toBeDefined();
    expect(DialogHeader).toBeDefined();
    expect(DialogFooter).toBeDefined();
    expect(DialogTitle).toBeDefined();

    const { root, container } = renderIntoDocument(
      React.createElement(
        Dialog as React.ComponentType,
        { open: true, onOpenChange: () => {} },
        React.createElement(
          DialogContent as React.ComponentType,
          { className: "test-dialog" },
          React.createElement(
            DialogHeader as React.ComponentType,
            { className: "test-dialog-header" },
            React.createElement(DialogTitle as React.ComponentType, null, "Test title"),
          ),
          React.createElement("div", { className: "test-dialog-body" }, "Body"),
          React.createElement(DialogFooter as React.ComponentType, null, "Footer"),
        ),
      ),
    );

    const overlay = document.body.querySelector("[data-state][data-dialog-overlay]");
    expect(overlay).not.toBeNull();

    const content = document.body.querySelector(".test-dialog");
    expect(content).not.toBeNull();
    expect(content?.textContent).toContain("Test title");
    expect(content?.textContent).toContain("Body");
    expect(content?.textContent).toContain("Footer");

    const closeButton = document.body.querySelector("button[aria-label='Close']");
    expect(closeButton).not.toBeNull();

    cleanupTestRoot({ root, container });
  });
});
