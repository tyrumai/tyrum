import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createBearerTokenAuth,
  createBrowserCookieAuth,
  createOperatorCore,
} from "../../operator-core/src/index.js";
import { ElevatedModeGate, ElevatedModeProvider } from "../src/index.js";
import {
  TEST_DEVICE_IDENTITY,
  requestInfoToUrl,
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

  it("uses baseline bearer auth to enter Elevated Mode", async () => {
    const issuedAt = "2026-02-27T00:00:00.000Z";
    const expiresAt = "2026-02-27T00:10:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(issuedAt));

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          token_kind: "device",
          token: "elevated-device-token",
          token_id: "token-1",
          device_id: TEST_DEVICE_IDENTITY.deviceId,
          role: "client",
          scopes: ["operator.admin"],
          issued_at: issuedAt,
          expires_at: expiresAt,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(ElevatedModeProvider, {
          core,
          mode: "web",
          children: React.createElement(
            ElevatedModeGate,
            null,
            React.createElement(
              "button",
              { type: "button", "data-testid": "danger-action" },
              "Danger action",
            ),
          ),
        }),
      );
    });

    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();
    expect(container.textContent).toContain("Enter Elevated Mode to continue");

    const enterButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-enter"]',
    );
    expect(enterButton).not.toBeNull();

    act(() => {
      enterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.querySelector('[data-testid="elevated-mode-dialog"]');
    expect(dialog).not.toBeNull();

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

    const issueCalls = fetchMock.mock.calls.filter(([input]) =>
      requestInfoToUrl(input).endsWith("/auth/device-tokens/issue"),
    );
    expect(issueCalls).toHaveLength(1);
    const [, callInit] = issueCalls[0] ?? [];
    const headers = new Headers(callInit?.headers);
    expect(callInit?.method).toBe("POST");
    expect(headers.get("authorization")).toBe("Bearer baseline");
    expect(JSON.parse(String(callInit?.body))).toMatchObject({
      device_id: TEST_DEVICE_IDENTITY.deviceId,
      role: "client",
    });
    expect(core.elevatedModeStore.getSnapshot()).toMatchObject({
      status: "active",
      elevatedToken: "elevated-device-token",
      expiresAt,
    });

    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("rejects a timed fallback Elevated Mode token without expires_at", async () => {
    const issuedAt = "2026-02-27T00:00:00.000Z";
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          token_kind: "device",
          token: "elevated-device-token",
          token_id: "token-1",
          device_id: TEST_DEVICE_IDENTITY.deviceId,
          role: "client",
          scopes: ["operator.admin"],
          issued_at: issuedAt,
          expires_at: null,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(ElevatedModeProvider, {
          core,
          mode: "web",
          children: React.createElement(
            ElevatedModeGate,
            null,
            React.createElement(
              "button",
              { type: "button", "data-testid": "danger-action" },
              "Danger action",
            ),
          ),
        }),
      );
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

    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();
    expect(document.body.textContent).toContain(
      "Gateway returned a timed elevated-mode token without expires_at.",
    );

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("uses baseline cookie auth to enter Elevated Mode in web mode", async () => {
    const issuedAt = "2026-02-27T00:00:00.000Z";
    const expiresAt = "2026-02-27T00:10:00.000Z";
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          token_kind: "device",
          token: "elevated-device-token",
          token_id: "token-1",
          device_id: TEST_DEVICE_IDENTITY.deviceId,
          role: "client",
          scopes: ["operator.admin"],
          issued_at: issuedAt,
          expires_at: expiresAt,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(ElevatedModeProvider, {
          core,
          mode: "web",
          children: React.createElement(
            ElevatedModeGate,
            null,
            React.createElement(
              "button",
              { type: "button", "data-testid": "danger-action" },
              "Danger action",
            ),
          ),
        }),
      );
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

    const issueCalls = fetchMock.mock.calls.filter(([input]) =>
      requestInfoToUrl(input).endsWith("/auth/device-tokens/issue"),
    );
    expect(issueCalls).toHaveLength(1);
    const [, callInit] = issueCalls[0] ?? [];
    const headers = new Headers(callInit?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(callInit?.credentials).toBe("include");
    expect(JSON.parse(String(callInit?.body))).toMatchObject({
      device_id: TEST_DEVICE_IDENTITY.deviceId,
      role: "client",
    });

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("renders an accessible Elevated Mode dialog and closes on Escape", () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(ElevatedModeProvider, {
          core,
          mode: "web",
          children: React.createElement(
            ElevatedModeGate,
            null,
            React.createElement(
              "button",
              { type: "button", "data-testid": "danger-action" },
              "Danger action",
            ),
          ),
        }),
      );
    });

    const enterButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-enter"]',
    );
    expect(enterButton).not.toBeNull();

    act(() => {
      enterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.querySelector('[data-testid="elevated-mode-dialog"]');
    expect(dialog).not.toBeNull();

    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBeTruthy();

    act(() => {
      dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(document.querySelector('[data-testid="elevated-mode-dialog"]')).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
}
