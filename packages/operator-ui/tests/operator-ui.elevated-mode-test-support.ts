import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import { AdminAccessGate, AdminAccessProvider, OperatorUiApp } from "../src/index.js";
import { TEST_DEVICE_IDENTITY } from "./operator-ui.test-support.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

function cleanup(root: Root | null, container: HTMLDivElement): void {
  act(() => {
    root?.unmount();
  });
  container.remove();
}

export function registerElevatedModeTests(): void {
  it("keeps admin access out of the global shell chrome", () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    act(() => {
      core.elevatedModeStore.enter({
        elevatedToken: "elevated-token",
        expiresAt: "2026-03-01T00:10:00.000Z",
      });
    });

    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();

    cleanup(root, container);
  });

  it("authorizes an admin-only action through the dialog without showing a global mode", async () => {
    const ws = new FakeWsClient();
    const { http, deviceTokensIssue } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(
          AdminAccessProvider,
          { core, mode: "web" },
          React.createElement(
            AdminAccessGate,
            null,
            React.createElement(
              "button",
              { type: "button", "data-testid": "danger-action" },
              "Danger action",
            ),
          ),
        ),
      );
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();
    expect(container.textContent).toContain("Authorize admin access to continue");

    const enterButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-enter"]',
    );
    expect(enterButton).not.toBeNull();

    act(() => {
      enterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmCheckbox = document.querySelector<HTMLElement>(
      '[data-testid="elevated-mode-confirm"]',
    );
    expect(confirmCheckbox).not.toBeNull();
    act(() => {
      confirmCheckbox!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const submitButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-submit"]',
    );
    expect(submitButton).not.toBeNull();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(deviceTokensIssue).toHaveBeenCalledTimes(1);
    expect(core.elevatedModeStore.getSnapshot()).toMatchObject({
      status: "active",
      elevatedToken: "elevated-device-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(container.querySelector('[data-testid="danger-action"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();

    cleanup(root, container);
  });

  it("clears active admin access on an unauthorized disconnect when a controller is present", async () => {
    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    core.elevatedModeStore.enter({
      elevatedToken: "persistent-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const controller = {
      enter: vi.fn(async () => {}),
      exit: vi.fn(async () => {}),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(
          AdminAccessProvider,
          {
            core,
            mode: "web",
            adminAccessController: controller,
          },
          React.createElement(
            AdminAccessGate,
            null,
            React.createElement("button", { type: "button", "data-testid": "danger-action" }, "Go"),
          ),
        ),
      );
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="danger-action"]')).not.toBeNull();

    await act(async () => {
      ws.emit("disconnected", { code: 4001, reason: "unauthorized" });
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();
    expect(container.querySelector('[data-testid="elevated-mode-enter"]')).not.toBeNull();

    cleanup(root, container);
  });
}
