// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupTestRoot,
  createTestRoot,
  type TestRoot,
} from "../../../packages/operator-ui/tests/test-utils.js";
import { getButtonByText, setTextareaValue } from "./test-utils/dom.js";

type ConsentRequestPayload = {
  request_id: string;
  payload?: {
    prompt?: unknown;
    context?: unknown;
    plan_id?: unknown;
    step_index?: unknown;
  };
};

describe("ConsentModal", () => {
  let testRoot: TestRoot;
  let onConsentRequestCallback: ((req: unknown) => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
    testRoot = createTestRoot();
    onConsentRequestCallback = null;

    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = {
      onConsentRequest: vi.fn((cb: (req: unknown) => void) => {
        onConsentRequestCallback = cb;
        return () => {};
      }),
      consentRespond: vi.fn(async () => {}),
    };
  });

  afterEach(() => {
    cleanupTestRoot(testRoot);
    delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
  });

  it("renders using operator-ui Dialog primitives when opened", async () => {
    const { ConsentModal } = await import("../src/renderer/components/ConsentModal.js");

    await act(async () => {
      testRoot.root.render(createElement(ConsentModal));
    });

    const request: ConsentRequestPayload = {
      request_id: "req-1",
      payload: {
        prompt: "Approval requested",
        context: "hello",
      },
    };

    await act(async () => {
      onConsentRequestCallback?.(request);
    });

    expect(document.querySelector("[data-dialog-overlay]")).not.toBeNull();
  });

  it("sends consent responses with the selected decision and optional reason", async () => {
    const { ConsentModal } = await import("../src/renderer/components/ConsentModal.js");

    await act(async () => {
      testRoot.root.render(createElement(ConsentModal));
    });

    const request: ConsentRequestPayload = {
      request_id: "req-2",
      payload: {
        prompt: "Run tool?",
        context: { foo: "bar" },
        plan_id: "plan-1",
        step_index: 3,
      },
    };

    await act(async () => {
      onConsentRequestCallback?.(request);
    });

    const textarea = document.querySelector("textarea");
    expect(textarea).not.toBeNull();
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("expected a textarea");
    }

    await act(async () => {
      setTextareaValue(textarea, "because");
    });

    const approve = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Approve",
    );
    expect(approve).not.toBeUndefined();
    if (!(approve instanceof HTMLButtonElement)) {
      throw new Error("expected approve button");
    }

    await act(async () => {
      approve.click();
      await Promise.resolve();
    });

    const api = window.tyrumDesktop as unknown as { consentRespond: ReturnType<typeof vi.fn> };
    expect(api.consentRespond).toHaveBeenCalledWith("req-2", true, "because");
  });

  it("resets the reason between requests and blocks dismiss shortcuts", async () => {
    const { ConsentModal } = await import("../src/renderer/components/ConsentModal.js");

    await act(async () => {
      testRoot.root.render(createElement(ConsentModal));
    });

    const request1: ConsentRequestPayload = {
      request_id: "req-3",
      payload: {
        prompt: "Run tool?",
        context: "hello",
      },
    };

    await act(async () => {
      onConsentRequestCallback?.(request1);
    });

    const textarea = document.querySelector("textarea");
    expect(textarea).not.toBeNull();
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("expected a textarea");
    }

    await act(async () => {
      setTextareaValue(textarea, "denied");
    });

    const request2: ConsentRequestPayload = {
      request_id: "req-4",
      payload: {
        prompt: "Run tool again?",
        context: { foo: "bar" },
      },
    };

    await act(async () => {
      onConsentRequestCallback?.(request2);
    });

    expect(textarea.value).toBe("");

    const preventDefaultSpy = vi.spyOn(Event.prototype, "preventDefault");

    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);

    preventDefaultSpy.mockClear();
    const overlay = document.querySelector("[data-dialog-overlay]");
    expect(overlay).not.toBeNull();
    if (!(overlay instanceof HTMLElement)) {
      throw new Error("expected overlay element");
    }

    const PointerDownEvent = window.PointerEvent ?? window.MouseEvent;
    overlay.dispatchEvent(new PointerDownEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(preventDefaultSpy).toHaveBeenCalled();

    preventDefaultSpy.mockRestore();

    const deny = getButtonByText("Deny");
    await act(async () => {
      deny.click();
      await Promise.resolve();
    });

    const api = window.tyrumDesktop as unknown as { consentRespond: ReturnType<typeof vi.fn> };
    expect(api.consentRespond).toHaveBeenCalledWith("req-4", false, undefined);
  });
});
