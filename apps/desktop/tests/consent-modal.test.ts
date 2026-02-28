// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  let container: HTMLElement;
  let root: Root;
  let onConsentRequestCallback: ((req: unknown) => void) | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    container = document.getElementById("root")!;
    root = createRoot(container);
    onConsentRequestCallback = null;

    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = {
      onConsentRequest: vi.fn((cb: (req: unknown) => void) => {
        onConsentRequestCallback = cb;
        return () => {};
      }),
      consentRespond: vi.fn(async () => {}),
    };
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
  });

  it("renders using operator-ui Dialog primitives when opened", async () => {
    const { ConsentModal } = await import("../src/renderer/components/ConsentModal.js");

    await act(async () => {
      root.render(createElement(ConsentModal));
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
      root.render(createElement(ConsentModal));
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
      textarea.value = "because";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
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
});
