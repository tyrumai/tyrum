// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("ConfirmDangerDialog", () => {
  it("requires explicit confirmation before enabling the danger action", async () => {
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

    const checkbox = document.body.querySelector(`[data-testid="confirm-danger-checkbox"]`);
    expect(checkbox).not.toBeNull();

    act(() => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(confirmButton?.disabled).toBe(false);

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);

    cleanupTestRoot({ container, root });
  });

  it("blocks submit when confirmDisabled becomes true before the click resolves", async () => {
    const ConfirmDangerDialog = (operatorUi as Record<string, unknown>)["ConfirmDangerDialog"];
    expect(ConfirmDangerDialog).toBeDefined();

    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();

    function Harness(): React.ReactElement {
      const [confirmDisabled, setConfirmDisabled] = React.useState(false);

      return React.createElement(React.Fragment, null, [
        React.createElement(
          "button",
          {
            key: "toggle",
            type: "button",
            "data-testid": "toggle-confirm-disabled",
            onClick: () => {
              setConfirmDisabled(true);
            },
          },
          "Disable confirm",
        ),
        React.createElement(ConfirmDangerDialog as React.ComponentType, {
          key: "dialog",
          open: true,
          onOpenChange,
          title: "Rotate secret",
          description: "This replaces the current secret value.",
          confirmLabel: "Rotate",
          confirmDisabled,
          onConfirm,
        }),
      ]);
    }

    const { container, root } = renderIntoDocument(React.createElement(Harness));

    const confirmButton = document.body.querySelector<HTMLButtonElement>(
      `[data-testid="confirm-danger-confirm"]`,
    );
    expect(confirmButton).not.toBeNull();
    expect(confirmButton?.disabled).toBe(true);

    const checkbox = document.body.querySelector(`[data-testid="confirm-danger-checkbox"]`);
    expect(checkbox).not.toBeNull();

    act(() => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(confirmButton?.disabled).toBe(false);

    const toggleButton = container.querySelector<HTMLButtonElement>(
      `[data-testid="toggle-confirm-disabled"]`,
    );
    expect(toggleButton).not.toBeNull();

    act(() => {
      toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(confirmButton?.disabled).toBe(true);

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    cleanupTestRoot({ container, root });
  });
});
