import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import { ElevatedModeGate, ElevatedModeProvider, OperatorUiApp } from "../src/index.js";
import {
  TEST_DEVICE_IDENTITY,
  openConfigureTab,
  stubPersistentStorage,
} from "./operator-ui.test-support.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

function registerElevatedModeBasicTests(): void {
  it("shows an Elevated Mode frame and allows exit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-27T00:00:00.000Z"));

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

    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();

    act(() => {
      core.elevatedModeStore.enter({ elevatedToken: "elevated-token", expiresAt: null });
    });

    const frame = container.querySelector('[data-testid="elevated-mode-frame"]');
    expect(frame).not.toBeNull();

    const exitButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-exit"]',
    );
    expect(exitButton).not.toBeNull();

    act(() => {
      exitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("gates an admin-only Configure action behind Elevated Mode", async () => {
    const expectedScopes = [
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.pairing",
      "operator.admin",
    ];

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
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    await openConfigureTab(container, "admin-http-tab-gateway");

    const issueButtonBeforeElevated = container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-http-device-tokens-issue"]',
    );
    expect(issueButtonBeforeElevated).not.toBeNull();
    expect(issueButtonBeforeElevated?.disabled).toBe(true);
    expect(container.textContent).toContain("Enter Elevated Mode to enable mutation actions.");

    const enterButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="configure-read-only-enter"]',
    );
    expect(enterButton).not.toBeNull();

    act(() => {
      enterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmCheckbox = document.querySelector<HTMLInputElement>(
      '[data-testid="elevated-mode-confirm"]',
    );
    expect(confirmCheckbox).not.toBeNull();
    act(() => {
      confirmCheckbox!.checked = true;
      confirmCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
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
    expect(deviceTokensIssue).toHaveBeenCalledWith({
      device_id: TEST_DEVICE_IDENTITY.deviceId,
      role: "client",
      scopes: expectedScopes,
      ttl_seconds: 60 * 10,
    });
    expect(core.elevatedModeStore.getSnapshot()).toMatchObject({
      status: "active",
      elevatedToken: "elevated-device-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).not.toBeNull();

    const commandsTab = container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-tab-commands"]',
    );
    expect(commandsTab).not.toBeNull();

    await act(async () => {
      commandsTab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      await Promise.resolve();
    });

    const commandInput = container.querySelector<HTMLInputElement>(
      '[data-testid="admin-ws-command-input"]',
    );
    expect(commandInput).not.toBeNull();
    act(() => {
      commandInput!.value = "/help";
      commandInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const executeButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-command-run"]',
    );
    expect(executeButton).not.toBeNull();

    await act(async () => {
      executeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(ws.commandExecute).toHaveBeenCalledWith("/help");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
}

function registerElevatedModePersistTests(): void {
  it("uses a provided elevated mode controller to enter persistent mode and persist it", async () => {
    const { session, local } = stubPersistentStorage();

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
      enter: vi.fn(async () => {
        core.elevatedModeStore.enter({ elevatedToken: "persistent-token", expiresAt: null });
      }),
      exit: vi.fn(async () => {
        core.elevatedModeStore.exit();
      }),
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

    const enterButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-enter"]',
    );
    expect(enterButton).not.toBeNull();

    act(() => {
      enterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmCheckbox = document.querySelector<HTMLInputElement>(
      '[data-testid="elevated-mode-confirm"]',
    );
    expect(confirmCheckbox).not.toBeNull();
    act(() => {
      confirmCheckbox!.checked = true;
      confirmCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const submitButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-submit"]',
    );
    expect(submitButton).not.toBeNull();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(controller.enter).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).not.toBeNull();

    const persistedRaw = session.get("tyrum.operator-ui.elevated-mode.v1");
    expect(persistedRaw).toBeTruthy();
    expect(JSON.parse(persistedRaw!)).toEqual({
      httpBaseUrl: "http://example.test",
      deviceId: TEST_DEVICE_IDENTITY.deviceId,
      elevatedToken: "persistent-token",
      expiresAt: null,
    });
    expect(local.has("tyrum.operator-ui.elevated-mode.v1")).toBe(false);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("rehydrates persistent elevated mode from sessionStorage when a controller is present", async () => {
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

    expect(controller.enter).not.toHaveBeenCalled();
    expect(core.elevatedModeStore.getSnapshot()).toMatchObject({
      status: "active",
      elevatedToken: "restored-token",
      expiresAt: null,
    });
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("clears current-session persistent elevated mode on unauthorized disconnect", async () => {
    const { session } = stubPersistentStorage();

    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    const controller = {
      enter: vi.fn(async () => {
        core.elevatedModeStore.enter({ elevatedToken: "persistent-token", expiresAt: null });
      }),
      exit: vi.fn(async () => {
        core.elevatedModeStore.exit();
      }),
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

    const enterButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-enter"]',
    );
    expect(enterButton).not.toBeNull();

    act(() => {
      enterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmCheckbox = document.querySelector<HTMLInputElement>(
      '[data-testid="elevated-mode-confirm"]',
    );
    expect(confirmCheckbox).not.toBeNull();
    act(() => {
      confirmCheckbox!.checked = true;
      confirmCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const submitButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-submit"]',
    );
    expect(submitButton).not.toBeNull();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot()).toMatchObject({
      status: "active",
      elevatedToken: "persistent-token",
      expiresAt: null,
    });
    expect(session.has("tyrum.operator-ui.elevated-mode.v1")).toBe(true);

    await act(async () => {
      ws.emit("disconnected", { code: 4001, reason: "unauthorized" });
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();
    expect(session.has("tyrum.operator-ui.elevated-mode.v1")).toBe(false);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("clears restored persistent elevated mode on unauthorized disconnect", async () => {
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

    await act(async () => {
      ws.emit("disconnected", { code: 4001, reason: "unauthorized" });
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();
    expect(session.has("tyrum.operator-ui.elevated-mode.v1")).toBe(false);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
}

function registerElevatedModeDisconnectTests(): void {
  it("keeps elevated mode active and shows a toast when controller exit fails", async () => {
    const toastError = vi.spyOn(toast, "error");
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    core.elevatedModeStore.enter({ elevatedToken: "persistent-token", expiresAt: null });

    const controller = {
      enter: vi.fn(async () => {}),
      exit: vi.fn(async () => {
        throw new Error("revoke failed");
      }),
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

    const exitButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-exit"]',
    );
    expect(exitButton).not.toBeNull();

    await act(async () => {
      exitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(controller.exit).toHaveBeenCalledTimes(1);
    expect(core.elevatedModeStore.getSnapshot().status).toBe("active");
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).not.toBeNull();
    expect(toastError).toHaveBeenCalledWith("revoke failed");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
}

export function registerElevatedModeTests(): void {
  registerElevatedModeBasicTests();
  registerElevatedModePersistTests();
  registerElevatedModeDisconnectTests();
}
