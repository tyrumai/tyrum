// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileSetupPage } from "../src/mobile-setup-page.js";
import { getDefaultLocationStreamingConfig } from "../src/mobile-config.js";
import {
  cleanupTestRoot,
  renderIntoDocument,
  setNativeValue,
} from "../../../packages/operator-ui/tests/test-utils.ts";

async function flushMicrotasks(count = 3): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

function getButton(container: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((entry) =>
      entry.textContent?.includes(label),
    ) ?? null
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("MobileSetupPage", () => {
  it("asks for confirmation before replacing a saved bootstrap config", async () => {
    const onSubmit = vi.fn(async () => {});

    const testRoot = renderIntoDocument(
      React.createElement(MobileSetupPage, {
        initialConfig: {
          httpBaseUrl: "https://next.example",
          wsUrl: "wss://next.example/ws",
          token: "next-token",
          nodeEnabled: true,
          actionSettings: {
            "location.get_current": true,
            "camera.capture_photo": true,
            "audio.record_clip": true,
          },
        },
        existingConfig: {
          httpBaseUrl: "https://saved.example",
          wsUrl: "wss://saved.example/ws",
          token: "saved-token",
          nodeEnabled: true,
          actionSettings: {
            "location.get_current": true,
            "camera.capture_photo": true,
            "audio.record_clip": true,
          },
        },
        onSubmit,
      }),
    );

    try {
      const saveButton = getButton(testRoot.container, "Save and connect");
      expect(saveButton).not.toBeNull();

      await act(async () => {
        saveButton?.click();
        await Promise.resolve();
      });

      expect(onSubmit).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("Replace saved mobile config?");

      const replaceButton = getButton(document.body, "Replace and connect");
      expect(replaceButton).not.toBeNull();

      await act(async () => {
        replaceButton?.click();
        await flushMicrotasks();
      });

      expect(onSubmit).toHaveBeenCalledWith({
        httpBaseUrl: "https://next.example",
        wsUrl: "wss://next.example/ws",
        token: "next-token",
        nodeEnabled: true,
        actionSettings: {
          "location.get_current": true,
          "camera.capture_photo": true,
          "audio.record_clip": true,
        },
        locationStreaming: getDefaultLocationStreamingConfig(),
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("prevents concurrent replace submissions while the confirmation save is in flight", async () => {
    let resolveSubmit: (() => void) | null = null;
    const onSubmit = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );

    const testRoot = renderIntoDocument(
      React.createElement(MobileSetupPage, {
        initialConfig: {
          httpBaseUrl: "https://next.example",
          wsUrl: "wss://next.example/ws",
          token: "next-token",
          nodeEnabled: true,
          actionSettings: {
            "location.get_current": true,
            "camera.capture_photo": true,
            "audio.record_clip": true,
          },
        },
        existingConfig: {
          httpBaseUrl: "https://saved.example",
          wsUrl: "wss://saved.example/ws",
          token: "saved-token",
          nodeEnabled: true,
          actionSettings: {
            "location.get_current": true,
            "camera.capture_photo": true,
            "audio.record_clip": true,
          },
        },
        onSubmit,
      }),
    );

    try {
      const saveButton = getButton(testRoot.container, "Save and connect");
      expect(saveButton).not.toBeNull();

      await act(async () => {
        saveButton?.click();
        await Promise.resolve();
      });

      const replaceButton = getButton(document.body, "Replace and connect");
      expect(replaceButton).not.toBeNull();

      await act(async () => {
        replaceButton?.click();
        replaceButton?.click();
        await Promise.resolve();
      });

      expect(onSubmit).toHaveBeenCalledTimes(1);

      const disabledReplaceButton = getButton(document.body, "Replace and connect");
      const disabledCancelButton = getButton(document.body, "Cancel");
      expect(disabledReplaceButton?.disabled).toBe(true);
      expect(disabledCancelButton?.disabled).toBe(true);

      await act(async () => {
        resolveSubmit?.();
        await flushMicrotasks();
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("fills the WebSocket field from the HTTP base URL when the field is empty", async () => {
    const onSubmit = vi.fn(async () => {});

    const testRoot = renderIntoDocument(
      React.createElement(MobileSetupPage, {
        initialConfig: null,
        onSubmit,
      }),
    );

    try {
      const inputs = Array.from(testRoot.container.querySelectorAll<HTMLInputElement>("input"));
      const httpInput = inputs[0] ?? null;
      const wsInput = inputs[1] ?? null;
      expect(httpInput).not.toBeNull();
      expect(wsInput).not.toBeNull();

      act(() => {
        setNativeValue(httpInput!, "https://gateway.example/");
      });

      expect(wsInput?.value).toBe("wss://gateway.example/ws");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("keeps unsaved form edits when initialConfig is recreated with the same visible values", async () => {
    const onSubmit = vi.fn(async () => {});
    const initialConfig = {
      httpBaseUrl: "https://saved.example",
      wsUrl: "wss://saved.example/ws",
      token: "saved-token",
      nodeEnabled: true,
      actionSettings: {
        "location.get_current": true,
        "camera.capture_photo": true,
        "audio.record_clip": true,
      },
    } as const;

    const testRoot = renderIntoDocument(
      React.createElement(MobileSetupPage, {
        initialConfig,
        onSubmit,
      }),
    );

    try {
      const inputs = Array.from(testRoot.container.querySelectorAll<HTMLInputElement>("input"));
      const httpInput = inputs[0] ?? null;
      expect(httpInput).not.toBeNull();

      act(() => {
        setNativeValue(httpInput!, "https://edited.example");
      });

      await act(async () => {
        testRoot.root.render(
          React.createElement(MobileSetupPage, {
            initialConfig: { ...initialConfig },
            onSubmit,
          }),
        );
        await flushMicrotasks();
      });

      expect(httpInput?.value).toBe("https://edited.example");

      await act(async () => {
        testRoot.root.render(
          React.createElement(MobileSetupPage, {
            initialConfig: {
              ...initialConfig,
              httpBaseUrl: "https://replaced.example",
            },
            onSubmit,
          }),
        );
        await flushMicrotasks();
      });

      expect(httpInput?.value).toBe("https://replaced.example");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
