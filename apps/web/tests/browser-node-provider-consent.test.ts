// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTestRoot } from "../../../packages/operator-ui/tests/test-utils.js";
import {
  cleanupBrowserNodeProviderHarness,
  flushEffects,
  getBrowserNodeRuntimeState,
  renderProvider,
  resetBrowserNodeProviderHarness,
  stubBrowserApis,
  stubLocalStorage,
} from "./browser-node-provider.test-support.js";

beforeEach(() => {
  resetBrowserNodeProviderHarness();
});

afterEach(() => {
  cleanupBrowserNodeProviderHarness();
});

describe("BrowserNodeProvider consent flow", () => {
  const BROWSER_NODE_CONSENT_TIMEOUT_MS = 15_000;

  async function clickDialogButton(label: string): Promise<void> {
    const button = Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    expect(button).not.toBeUndefined();
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
  }

  it(
    "returns a disabled error before the browser node is enabled",
    async () => {
      stubLocalStorage();
      stubBrowserApis();

      const { testRoot, waitForApi } = await renderProvider();

      try {
        await flushEffects();
        const api = await waitForApi();

        expect(api.status).toBe("disabled");
        await expect(
          api.executeLocal({
            op: "get",
            enable_high_accuracy: false,
            timeout_ms: 30_000,
            maximum_age_ms: 0,
          }),
        ).resolves.toEqual({
          success: false,
          error: "browser node is not enabled",
        });
      } finally {
        cleanupTestRoot(testRoot);
      }
    },
    BROWSER_NODE_CONSENT_TIMEOUT_MS,
  );

  it(
    "serializes consent requests and resolves them through dialog actions",
    async () => {
      stubLocalStorage({ "tyrum.operator-ui.browserNode.enabled": "1" });
      stubBrowserApis();

      const { testRoot, waitForApi } = await renderProvider();

      try {
        await flushEffects();
        const api = await waitForApi();

        expect(api.status).toBe("connected");

        let firstRequest!: ReturnType<typeof api.executeLocal>;
        await act(async () => {
          firstRequest = api.executeLocal({
            op: "get",
            enable_high_accuracy: false,
            timeout_ms: 30_000,
            maximum_age_ms: 0,
          });
          await Promise.resolve();
        });
        await flushEffects();

        let secondRequest!: ReturnType<typeof api.executeLocal>;
        await act(async () => {
          secondRequest = api.executeLocal({
            op: "capture_photo",
            format: "jpeg",
            quality: 0.8,
          });
          await Promise.resolve();
        });
        await flushEffects();

        expect(
          document.querySelector("[data-testid='browser-node-consent-dialog']"),
        ).not.toBeNull();
        expect(document.body.textContent).toContain("Attempt");
        expect(document.body.textContent).toContain("local");
        const attemptCode = document.querySelector(
          "[data-testid='browser-node-consent-dialog'] code.font-mono",
        );
        expect(attemptCode?.textContent).toContain("local");

        await clickDialogButton("Deny");
        await flushEffects();
        await expect(firstRequest).resolves.toMatchObject({
          success: false,
          error: "location access denied",
        });

        await clickDialogButton("Deny");
        await flushEffects();
        await expect(secondRequest).resolves.toMatchObject({
          success: false,
          error: "camera access denied",
        });

        let thirdRequest!: ReturnType<typeof api.executeLocal>;
        await act(async () => {
          thirdRequest = api.executeLocal({
            op: "record",
            duration_ms: 25,
          });
          await Promise.resolve();
        });
        await flushEffects();
        await clickDialogButton("Deny");
        await flushEffects();
        await expect(thirdRequest).resolves.toMatchObject({
          success: false,
          error: "microphone access denied",
        });

        let fourthRequest!: ReturnType<typeof api.executeLocal>;
        await act(async () => {
          fourthRequest = api.executeLocal({
            op: "record",
            duration_ms: 25,
          });
          await Promise.resolve();
        });
        await flushEffects();

        await clickDialogButton("Allow");
        await flushEffects();

        await expect(fourthRequest).resolves.toMatchObject({
          success: true,
          evidence: {
            op: "record",
          },
        });
      } finally {
        cleanupTestRoot(testRoot);
      }
    },
    BROWSER_NODE_CONSENT_TIMEOUT_MS,
  );

  it(
    "auto-allows consent when the automation flag is enabled",
    async () => {
      stubLocalStorage({
        "tyrum.operator-ui.browserNode.enabled": "1",
        "tyrum.operator-ui.browserNode.autoConsent": "1",
      });
      stubBrowserApis();

      const { testRoot, waitForApi } = await renderProvider();

      try {
        await flushEffects();
        const api = await waitForApi();

        expect(api.status).toBe("connected");
        await expect(
          api.executeLocal({
            op: "get",
            enable_high_accuracy: false,
            timeout_ms: 30_000,
            maximum_age_ms: 0,
          }),
        ).resolves.toMatchObject({
          success: true,
          evidence: {
            op: "get",
            context: {
              requestId: "local",
            },
          },
        });
        expect(document.querySelector("[data-testid='browser-node-consent-dialog']")).toBeNull();
      } finally {
        cleanupTestRoot(testRoot);
      }
    },
    BROWSER_NODE_CONSENT_TIMEOUT_MS,
  );

  it(
    "clears active and queued consent requests when disabled and stale providers reject immediately",
    async () => {
      stubLocalStorage({ "tyrum.operator-ui.browserNode.enabled": "1" });
      stubBrowserApis();

      const { getApi, testRoot, waitForApi } = await renderProvider();

      try {
        await flushEffects();
        const api = await waitForApi();
        const lifecycleInput = getBrowserNodeRuntimeState().lifecycleInputs.at(-1);
        expect(lifecycleInput?.providers).toBeDefined();
        const provider = lifecycleInput?.providers?.[0] as {
          execute: (action: { type: string; args: unknown }, ctx?: unknown) => Promise<unknown>;
        };

        let first!: Promise<unknown>;
        let second!: Promise<unknown>;
        let third!: Promise<unknown>;
        await act(async () => {
          first = provider.execute(
            {
              type: "Browser",
              args: {
                op: "get",
                enable_high_accuracy: false,
                timeout_ms: 30_000,
                maximum_age_ms: 0,
              },
            },
            { attemptId: "queued-1" },
          );
          second = provider.execute(
            {
              type: "Browser",
              args: { op: "capture_photo", format: "jpeg", quality: 0.8 },
            },
            { attemptId: "queued-2" },
          );
          third = provider.execute(
            {
              type: "Browser",
              args: { op: "record", duration_ms: 25 },
            },
            { attemptId: "queued-3" },
          );
          await Promise.resolve();
        });
        await flushEffects();

        await act(async () => {
          api.setEnabled(false);
          await Promise.resolve();
        });
        await flushEffects();

        await expect(first).resolves.toMatchObject({
          success: false,
          error: "location access denied",
        });
        await expect(second).resolves.toMatchObject({
          success: false,
          error: "camera access denied",
        });
        await expect(third).resolves.toMatchObject({
          success: false,
          error: "microphone access denied",
        });

        await expect(
          provider.execute(
            {
              type: "Browser",
              args: {
                op: "get",
                enable_high_accuracy: false,
                timeout_ms: 30_000,
                maximum_age_ms: 0,
              },
            },
            { attemptId: "stale-provider" },
          ),
        ).resolves.toMatchObject({
          success: false,
          error: "location access denied",
        });
        expect(getApi().status).toBe("disabled");
      } finally {
        cleanupTestRoot(testRoot);
      }
    },
    BROWSER_NODE_CONSENT_TIMEOUT_MS,
  );
});
