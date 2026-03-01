// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("ConfirmDangerDialog", () => {
  it("requires explicit confirmation before enabling the danger action", () => {
    const ConfirmDangerDialog = (operatorUi as Record<string, unknown>)["ConfirmDangerDialog"];
    expect(ConfirmDangerDialog).toBeDefined();

    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();

    const { container, root } = renderIntoDocument(
      React.createElement(ConfirmDangerDialog as React.ComponentType, {
        open: true,
        onOpenChange,
        title: "Delete run",
        description: "This cannot be undone.",
        confirmLabel: "Delete",
        onConfirm,
      }),
    );

    const confirmButton = document.body.querySelector<HTMLButtonElement>(
      `[data-testid="confirm-danger-confirm"]`,
    );
    expect(confirmButton).not.toBeNull();
    expect(confirmButton?.disabled).toBe(true);

    const checkbox = document.body.querySelector<HTMLInputElement>(
      `[data-testid="confirm-danger-checkbox"]`,
    );
    expect(checkbox).not.toBeNull();

    act(() => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(confirmButton?.disabled).toBe(false);

    act(() => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);

    cleanupTestRoot({ container, root });
  });
});

