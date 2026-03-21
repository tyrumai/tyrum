// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestActionsPanel } from "../../src/components/pages/node-config/node-config-page.test-actions.js";
import { click, cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const { toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

async function flushMicrotasks(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("TestActionsPanel", () => {
  it("keeps structured test results inside a bounded scroll container", async () => {
    const onRun = vi.fn(async () => ({
      success: true,
      evidence: {
        bytesBase64: "a".repeat(900),
        status: "ok",
      },
    }));
    const testRoot = renderIntoDocument(
      React.createElement(TestActionsPanel, {
        testActions: [
          {
            label: "Run check",
            actionName: "run-check",
            available: true,
            onRun,
          },
        ],
      }),
    );

    const button = Array.from(testRoot.container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "Run check",
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);

    act(() => {
      click(button as HTMLButtonElement);
    });

    await act(async () => {
      await flushMicrotasks();
    });

    const scrollContainer = Array.from(testRoot.container.querySelectorAll("div")).find(
      (div) =>
        typeof div.className === "string" &&
        div.className.includes("max-h-[420px]") &&
        div.className.includes("overflow-auto"),
    );

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith("Test action succeeded");
    expect(scrollContainer).not.toBeUndefined();
    expect(testRoot.container.querySelector("pre")).toBeNull();
    expect(testRoot.container.textContent).toContain("Evidence");
    expect(testRoot.container.textContent).toContain("[omitted 900 chars]");
    expect(testRoot.container.textContent).toContain("Bytes omitted");

    cleanupTestRoot(testRoot);
  });
});
