import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import {
  EXECUTION_PROFILE_IDS,
  openConfigureTab,
  setControlledInputValue,
  createDeferred,
} from "./operator-ui.test-support.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

function registerConfigureActionsPluginTests(): void {
  it("disables Configure model assignment save while a request is in flight", async () => {
    const refreshDeferred = createDeferred<Response>();

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const fetchMock = vi.fn(async () => await refreshDeferred.promise);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });

      await openConfigureTab(container, "admin-http-tab-models");
      const selects = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
      expect(selects.length).toBeGreaterThan(0);
      const saveButton = container.querySelector<HTMLButtonElement>(
        '[data-testid="models-assignments-save"]',
      );
      expect(saveButton).not.toBeNull();
      expect(saveButton?.disabled).toBe(true);

      act(() => {
        const select = selects[0];
        if (!select) return;
        const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")
          ?.set as ((this: HTMLSelectElement, value: string) => void) | undefined;
        setValue?.call(select, "preset-review");
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });

      expect(saveButton?.disabled).toBe(false);

      await act(async () => {
        saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [input, init] = fetchMock.mock.calls[0] ?? [];
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe("http://example.test/config/models/assignments");
      expect(init?.method).toBe("PUT");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer elevated-test-token");
      expect(saveButton?.disabled).toBe(true);

      refreshDeferred.resolve(
        new Response(
          JSON.stringify({
            status: "ok",
            assignments: EXECUTION_PROFILE_IDS.map((execution_profile_id) => ({
              execution_profile_id,
              preset_key:
                execution_profile_id === "interaction" ? "preset-review" : "preset-default",
              preset_display_name: execution_profile_id === "interaction" ? "Review" : "Default",
              provider_key: "openai",
              model_id: execution_profile_id === "interaction" ? "gpt-4.1-mini" : "gpt-4.1",
            })),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
      await act(async () => {
        await Promise.resolve();
      });

      expect(saveButton?.disabled).toBe(true);
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });
}

function registerConfigureActionsModelTests(): void {
  it("requires confirmation before removing a model preset from Configure", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ status: "ok", models_dev: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });
      await openConfigureTab(container, "admin-http-tab-models");

      const removeButtons = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button"),
      ).filter((button) => button.textContent?.trim() === "Remove");
      expect(removeButtons.length).toBeGreaterThanOrEqual(2);
      const removeButton = removeButtons[1];
      expect(removeButton).not.toBeUndefined();

      act(() => {
        removeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(fetchMock).toHaveBeenCalledTimes(0);

      const confirmButton = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="confirm-danger-confirm"]',
      );
      expect(confirmButton).not.toBeNull();
      expect(confirmButton?.disabled).toBe(true);

      const checkbox = document.body.querySelector('[data-testid="confirm-danger-checkbox"]');
      expect(checkbox).not.toBeNull();
      act(() => {
        checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(confirmButton?.disabled).toBe(false);

      await act(async () => {
        confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [input, init] = fetchMock.mock.calls[0] ?? [];
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe("http://example.test/config/models/presets/preset-review");
      expect(init?.method).toBe("DELETE");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer elevated-test-token");
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it("shows a friendly error when issuing a device token with an invalid TTL", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });
      await openConfigureTab(container, "admin-http-tab-gateway");
      const tokensCard = container.querySelector<HTMLElement>('[data-testid="admin-http-tokens"]');
      expect(tokensCard).not.toBeNull();

      const ttlInput = tokensCard?.querySelector<HTMLInputElement>('input[type="number"]');
      expect(ttlInput).not.toBeNull();

      act(() => {
        setControlledInputValue(ttlInput!, "0");
      });

      const issueButton = container.querySelector<HTMLButtonElement>(
        '[data-testid="admin-http-tokens-issue"]',
      );
      expect(issueButton).not.toBeNull();

      act(() => {
        issueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const checkbox = document.body.querySelector('[data-testid="confirm-danger-checkbox"]');
      expect(checkbox).not.toBeNull();
      act(() => {
        checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const confirmButton = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="confirm-danger-confirm"]',
      );
      expect(confirmButton).not.toBeNull();
      expect(confirmButton?.disabled).toBe(false);

      await act(async () => {
        confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      const dialog = document.body.querySelector<HTMLElement>(
        '[data-testid="confirm-danger-dialog"]',
      );
      expect(dialog).not.toBeNull();

      const alert = dialog?.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("Action failed");
      expect(alert?.textContent).toContain("TTL must be a positive integer");
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });
}

export function registerConfigureActionsTests(): void {
  registerConfigureActionsPluginTests();
  registerConfigureActionsModelTests();
}
