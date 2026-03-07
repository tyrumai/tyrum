import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createBearerTokenAuth,
  createOperatorCore,
} from "../../operator-core/src/index.js";
import { ElevatedModeGate, ElevatedModeProvider } from "../src/index.js";
import {
  TEST_DEVICE_IDENTITY,
  stubPersistentStorage,
} from "./operator-ui.test-support.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

export function registerElevatedModePersistenceTests(): void {
  it("clears persistent elevated mode when the controller becomes available after a 4001 disconnect", async () => {
    const session = new Map<string, string>();
    session.set(
      "tyrum.operator-ui.elevated-mode.v1",
      JSON.stringify({
        httpBaseUrl: "http://example.test",
        deviceId: TEST_DEVICE_IDENTITY.deviceId,
        elevatedToken: "restored-token",
        expiresAt: null,
      }),
    );
    stubPersistentStorage({ session });

    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    core.elevatedModeStore.enter({ elevatedToken: "restored-token", expiresAt: null });

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
          ElevatedModeProvider,
          {
            core,
            mode: "web",
          },
          React.createElement(
            ElevatedModeGate,
            null,
            React.createElement("button", { type: "button", "data-testid": "danger-action" }, "Go"),
          ),
        ),
      );
      await Promise.resolve();
    });

    await act(async () => {
      ws.emit("disconnected", { code: 4001, reason: "unauthorized" });
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot().status).toBe("active");
    expect(session.has("tyrum.operator-ui.elevated-mode.v1")).toBe(true);

    await act(async () => {
      root?.render(
        React.createElement(
          ElevatedModeProvider,
          {
            core,
            mode: "web",
            elevatedModeController: controller,
          },
          React.createElement(
            ElevatedModeGate,
            null,
            React.createElement("button", { type: "button", "data-testid": "danger-action" }, "Go"),
          ),
        ),
      );
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
    expect(session.has("tyrum.operator-ui.elevated-mode.v1")).toBe(false);
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("migrates legacy web persistence from localStorage into sessionStorage", async () => {
    const local = new Map<string, string>();
    local.set(
      "tyrum.operator-ui.elevated-mode.v1",
      JSON.stringify({
        httpBaseUrl: "http://example.test",
        deviceId: TEST_DEVICE_IDENTITY.deviceId,
        elevatedToken: "legacy-token",
        expiresAt: null,
      }),
    );
    const { session } = stubPersistentStorage({ local });

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
          ElevatedModeProvider,
          {
            core,
            mode: "web",
            elevatedModeController: controller,
          },
          React.createElement("div", null, "child"),
        ),
      );
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot()).toMatchObject({
      status: "active",
      elevatedToken: "legacy-token",
      expiresAt: null,
    });
    expect(session.get("tyrum.operator-ui.elevated-mode.v1")).toBeTruthy();
    expect(local.has("tyrum.operator-ui.elevated-mode.v1")).toBe(false);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("clears invalid persisted elevated mode state during restore", async () => {
    const session = new Map<string, string>();
    session.set(
      "tyrum.operator-ui.elevated-mode.v1",
      JSON.stringify({
        httpBaseUrl: "http://example.test",
        deviceId: TEST_DEVICE_IDENTITY.deviceId,
        elevatedToken: "bad-token",
        expiresAt: "not-an-iso-date",
      }),
    );
    stubPersistentStorage({ session });

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
          ElevatedModeProvider,
          {
            core,
            mode: "web",
            elevatedModeController: controller,
          },
          React.createElement(
            ElevatedModeGate,
            null,
            React.createElement("button", { type: "button", "data-testid": "danger-action" }, "Go"),
          ),
        ),
      );
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
    expect(session.has("tyrum.operator-ui.elevated-mode.v1")).toBe(false);
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("clears expired persisted elevated mode state during restore", async () => {
    const session = new Map<string, string>();
    session.set(
      "tyrum.operator-ui.elevated-mode.v1",
      JSON.stringify({
        httpBaseUrl: "http://example.test",
        deviceId: TEST_DEVICE_IDENTITY.deviceId,
        elevatedToken: "expired-token",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    );
    stubPersistentStorage({ session });

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
          ElevatedModeProvider,
          {
            core,
            mode: "web",
            elevatedModeController: controller,
          },
          React.createElement(
            ElevatedModeGate,
            null,
            React.createElement("button", { type: "button", "data-testid": "danger-action" }, "Go"),
          ),
        ),
      );
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
    expect(session.has("tyrum.operator-ui.elevated-mode.v1")).toBe(false);
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

}
