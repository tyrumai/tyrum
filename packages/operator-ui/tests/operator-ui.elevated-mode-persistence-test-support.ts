import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-app/src/index.js";
import { AdminAccessGate, AdminAccessProvider } from "../src/index.js";
import { TEST_DEVICE_IDENTITY, stubPersistentStorage } from "./operator-ui.test-support.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

function cleanup(root: Root | null, container: HTMLDivElement): void {
  act(() => {
    root?.unmount();
  });
  container.remove();
}

export function registerElevatedModePersistenceTests(): void {
  it("does not restore admin access from persisted browser storage", async () => {
    const session = new Map<string, string>();
    const local = new Map<string, string>();
    const persistedValue = JSON.stringify({
      httpBaseUrl: "http://example.test",
      deviceId: TEST_DEVICE_IDENTITY.deviceId,
      elevatedToken: "restored-token",
      expiresAt: "2026-03-01T00:10:00.000Z",
    });
    session.set("tyrum.operator-ui.elevated-mode.v1", persistedValue);
    local.set("tyrum.operator-ui.elevated-mode.v1", persistedValue);
    stubPersistentStorage({ session, local });

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
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

    expect(controller.enter).not.toHaveBeenCalled();
    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();
    expect(container.querySelector('[data-testid="elevated-mode-enter"]')).not.toBeNull();

    cleanup(root, container);
  });
}
