// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React, { act } from "react";
import {
  useApiResultState,
  type ApiResultState,
} from "../../src/components/pages/admin-http-panels.shared.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: ((value: T) => void) | null = null;
  let reject: ((error: unknown) => void) | null = null;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  if (!resolve || !reject) {
    throw new Error("Failed to create deferred promise");
  }

  return { promise, resolve, reject };
}

function Probe({
  failGate,
  successGate,
  stateRef,
}: {
  failGate: ReturnType<typeof createDeferred<void>>;
  successGate: ReturnType<typeof createDeferred<void>>;
  stateRef: { current: ApiResultState | null };
}): React.ReactElement {
  const { state, run } = useApiResultState("initial");
  stateRef.current = state;

  return React.createElement(
    "button",
    {
      type: "button",
      "data-testid": "trigger",
      onClick() {
        void run("fail", async () => {
          await failGate.promise;
          throw new Error("fail");
        });
        void run("success", async () => {
          await successGate.promise;
          return { ok: true };
        });
      },
    },
    "Trigger",
  );
}

describe("useApiResultState", () => {
  it("clears stale error when a later run succeeds", async () => {
    const failGate = createDeferred<void>();
    const successGate = createDeferred<void>();
    const stateRef: { current: ApiResultState | null } = { current: null };

    const testRoot = renderIntoDocument(
      React.createElement(Probe, { failGate, successGate, stateRef }),
    );

    try {
      const trigger =
        testRoot.container.querySelector<HTMLButtonElement>("[data-testid='trigger']");
      expect(trigger).not.toBeNull();

      act(() => {
        trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      await act(async () => {
        failGate.resolve();
        await Promise.resolve();
      });

      expect(stateRef.current?.error).toBeInstanceOf(Error);

      await act(async () => {
        successGate.resolve();
        await Promise.resolve();
      });

      expect(stateRef.current?.value).toEqual({ ok: true });
      expect(stateRef.current?.error).toBeUndefined();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
