// @vitest-environment jsdom
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
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

type DesktopApiStub = {
  consentRespond: ReturnType<typeof vi.fn>;
  emitConsentRequest: (req: ConsentRequestPayload) => void;
  waitForSubscription: () => Promise<void>;
  cleanup: () => void;
};

function stubDesktopApi(): DesktopApiStub {
  let onConsentRequestCallback: ((req: unknown) => void) | null = null;

  const consentRespond = vi.fn(async () => {});
  const onConsentRequest = vi.fn((cb: (req: unknown) => void) => {
    onConsentRequestCallback = cb;
    return () => {};
  });

  (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = {
    onConsentRequest,
    consentRespond,
  };

  return {
    consentRespond,
    emitConsentRequest(req) {
      onConsentRequestCallback?.(req);
    },
    async waitForSubscription() {
      await expect.poll(() => onConsentRequestCallback, { timeout: 5_000 }).not.toBeNull();
    },
    cleanup() {
      delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
    },
  };
}

async function setupConsentModal(): Promise<{
  testRoot: TestRoot;
  desktop: DesktopApiStub;
  openRequest: (request: ConsentRequestPayload) => Promise<void>;
  getTextarea: () => Promise<HTMLTextAreaElement>;
  cleanup: () => void;
}> {
  vi.useRealTimers();
  document.body.innerHTML = "";

  const testRoot = createTestRoot();
  const desktop = stubDesktopApi();

  const { ConsentModal } = await import("../src/renderer/components/ConsentModal.js");
  await act(async () => {
    testRoot.root.render(createElement(ConsentModal));
  });

  await desktop.waitForSubscription();

  const openRequest = async (request: ConsentRequestPayload): Promise<void> => {
    await act(async () => {
      desktop.emitConsentRequest(request);
    });
    await expect
      .poll(() => document.querySelector("[data-dialog-overlay]"), { timeout: 5_000 })
      .not.toBeNull();
  };

  const getTextarea = async (): Promise<HTMLTextAreaElement> => {
    await expect.poll(() => document.querySelector("textarea"), { timeout: 5_000 }).not.toBeNull();
    const textarea = document.querySelector("textarea");
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("expected a textarea");
    }
    return textarea;
  };

  return {
    testRoot,
    desktop,
    openRequest,
    getTextarea,
    cleanup() {
      cleanupTestRoot(testRoot);
      desktop.cleanup();
    },
  };
}

describe("ConsentModal", () => {
  it("renders using operator-ui Dialog primitives when opened", { timeout: 15_000 }, async () => {
    const harness = await setupConsentModal();
    try {
      await harness.openRequest({
        request_id: "req-1",
        payload: { prompt: "Approval requested", context: "hello" },
      });

      expect(document.querySelector("[data-dialog-overlay]")).not.toBeNull();
    } finally {
      harness.cleanup();
    }
  });
});

describe("ConsentModal consent responses", () => {
  it(
    "sends consent responses with the selected decision and optional reason",
    { timeout: 15_000 },
    async () => {
      const harness = await setupConsentModal();
      try {
        await harness.openRequest({
          request_id: "req-2",
          payload: {
            prompt: "Run tool?",
            context: { foo: "bar" },
            plan_id: "plan-1",
            step_index: 3,
          },
        });

        const textarea = await harness.getTextarea();
        await act(async () => {
          setTextareaValue(textarea, "because");
        });

        const approve = getButtonByText("Approve");
        await act(async () => {
          approve.click();
          await Promise.resolve();
        });

        expect(harness.desktop.consentRespond).toHaveBeenCalledWith("req-2", true, "because");
      } finally {
        harness.cleanup();
      }
    },
  );
});

describe("ConsentModal request lifecycle", () => {
  it(
    "resets the reason between requests and blocks dismiss shortcuts",
    { timeout: 15_000 },
    async () => {
      const harness = await setupConsentModal();
      const preventDefaultSpy = vi.spyOn(Event.prototype, "preventDefault");

      try {
        await harness.openRequest({
          request_id: "req-3",
          payload: { prompt: "Run tool?", context: "hello" },
        });

        const textarea = await harness.getTextarea();
        await act(async () => {
          setTextareaValue(textarea, "denied");
        });

        await harness.openRequest({
          request_id: "req-4",
          payload: { prompt: "Run tool again?", context: { foo: "bar" } },
        });

        expect(textarea.value).toBe("");

        const escape = new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        });
        document.dispatchEvent(escape);
        expect(escape.defaultPrevented).toBe(true);

        preventDefaultSpy.mockClear();
        const overlay = document.querySelector("[data-dialog-overlay]");
        expect(overlay).not.toBeNull();
        if (!(overlay instanceof HTMLElement)) {
          throw new Error("expected overlay element");
        }

        const PointerDownEvent = window.PointerEvent ?? window.MouseEvent;
        overlay.dispatchEvent(
          new PointerDownEvent("pointerdown", { bubbles: true, cancelable: true }),
        );
        expect(preventDefaultSpy).toHaveBeenCalled();

        const deny = getButtonByText("Deny");
        await act(async () => {
          deny.click();
          await Promise.resolve();
        });

        expect(harness.desktop.consentRespond).toHaveBeenCalledWith("req-4", false, undefined);
      } finally {
        preventDefaultSpy.mockRestore();
        harness.cleanup();
      }
    },
  );
});
