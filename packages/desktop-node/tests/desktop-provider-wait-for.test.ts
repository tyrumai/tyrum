import { describe, expect, it, vi } from "vitest";
import type { ActionPrimitive } from "@tyrum/contracts";
import { DesktopProvider, MockDesktopBackend, type ConfirmationFn } from "@tyrum/desktop-node";

import type { OcrEngine } from "../src/providers/ocr/types.js";

function makeAction(args: Record<string, unknown>): ActionPrimitive {
  return { type: "Desktop", args };
}

describe("DesktopProvider (wait_for)", () => {
  it("wait_for(exists) returns satisfied when an OCR match is present", async () => {
    const backend = new MockDesktopBackend();
    const permissions = {
      desktopScreenshot: true,
      desktopInput: false,
      desktopInputRequiresConfirmation: false,
    };

    const ocr = {
      recognize: vi.fn(async () => [
        {
          text: "Save",
          bounds: { x: 10, y: 20, width: 80, height: 24 },
          confidence: 0.9,
        },
      ]),
    } satisfies OcrEngine;

    const provider = new DesktopProvider(backend, permissions, vi.fn<ConfirmationFn>(), ocr);

    const result = await provider.execute(
      makeAction({
        op: "wait_for",
        selector: { kind: "ocr", text: "save" },
        state: "exists",
        timeout_ms: 1_000,
        poll_ms: 50,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      op: "wait_for",
      state: "exists",
      status: "satisfied",
    });
    expect((result.result as Record<string, unknown>)["match"]).toMatchObject({
      kind: "ocr",
      text: "Save",
      bounds: { x: 10, y: 20, width: 80, height: 24 },
      confidence: 0.9,
    });
    expect(ocr.recognize).toHaveBeenCalledTimes(1);
    expect(backend.calls.map((c) => c.method)).toContain("captureScreen");
  });

  it("wait_for polls until satisfied when a match appears later", async () => {
    vi.useFakeTimers();

    try {
      const backend = new MockDesktopBackend();
      const permissions = {
        desktopScreenshot: true,
        desktopInput: false,
        desktopInputRequiresConfirmation: false,
      };

      let calls = 0;
      const ocr = {
        recognize: vi.fn(async () => {
          calls += 1;
          if (calls === 1) return [];
          return [{ text: "Ready", bounds: { x: 5, y: 6, width: 10, height: 10 } }];
        }),
      } satisfies OcrEngine;

      const provider = new DesktopProvider(backend, permissions, vi.fn<ConfirmationFn>(), ocr);

      const promise = provider.execute(
        makeAction({
          op: "wait_for",
          selector: { kind: "ocr", text: "ready" },
          state: "visible",
          timeout_ms: 250,
          poll_ms: 50,
        }),
      );

      await vi.advanceTimersByTimeAsync(260);

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        op: "wait_for",
        state: "visible",
        status: "satisfied",
      });
      expect(ocr.recognize).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("wait_for(hidden) returns satisfied when no matches are present", async () => {
    const backend = new MockDesktopBackend();
    const permissions = {
      desktopScreenshot: true,
      desktopInput: false,
      desktopInputRequiresConfirmation: false,
    };

    const ocr = {
      recognize: vi.fn(async () => []),
    } satisfies OcrEngine;

    const provider = new DesktopProvider(backend, permissions, vi.fn<ConfirmationFn>(), ocr);

    const result = await provider.execute(
      makeAction({
        op: "wait_for",
        selector: { kind: "ocr", text: "missing" },
        state: "hidden",
        timeout_ms: 0,
        poll_ms: 50,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      op: "wait_for",
      state: "hidden",
      status: "satisfied",
    });
  });

  it("wait_for(hidden) does not satisfy when query fails (OCR unavailable)", async () => {
    const backend = new MockDesktopBackend();
    const permissions = {
      desktopScreenshot: true,
      desktopInput: false,
      desktopInputRequiresConfirmation: false,
    };

    const provider = new DesktopProvider(backend, permissions, vi.fn<ConfirmationFn>());

    const result = await provider.execute(
      makeAction({
        op: "wait_for",
        selector: { kind: "ocr", text: "missing" },
        state: "hidden",
        timeout_ms: 0,
        poll_ms: 50,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      op: "wait_for",
      state: "hidden",
      status: "timeout",
    });
    expect(backend.calls).toEqual([]);
  });
});
