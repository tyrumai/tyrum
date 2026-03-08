import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createBearerTokenAuth,
  createBrowserCookieAuth,
  createOperatorCore,
} from "../../operator-core/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

function registerLoginFormTests(): void {
  it("disables browser assistance on the login token field", () => {
    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    const tokenField = container.querySelector<HTMLTextAreaElement>('[data-testid="login-token"]');
    expect(tokenField).not.toBeNull();
    expect(tokenField!.getAttribute("spellcheck")).toBe("false");
    expect(tokenField!.getAttribute("autocapitalize")).toBe("none");
    expect(tokenField!.getAttribute("autocorrect")).toBe("off");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("wraps the connect screen in a scroll area", () => {
    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    const scrollArea = container.querySelector<HTMLElement>("[data-scroll-area-root]");
    expect(scrollArea).not.toBeNull();
    expect(scrollArea?.className).toContain("h-full");
    expect(scrollArea?.className).toContain("w-full");
    expect(container.querySelector('[data-testid="login-button"]')).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("sets aria-busy on the login button while logging in", async () => {
    let resolveFetch: ((response: Response) => void) | null = null;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(async () => fetchPromise);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    const tokenField = container.querySelector<HTMLTextAreaElement>('[data-testid="login-token"]');
    expect(tokenField).not.toBeNull();
    act(() => {
      tokenField!.value = "test-token";
    });

    const loginButton = container.querySelector<HTMLButtonElement>('[data-testid="login-button"]');
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const liveButton = container.querySelector<HTMLButtonElement>('[data-testid="login-button"]');
    expect(liveButton?.getAttribute("aria-busy")).toBe("true");

    resolveFetch?.(new Response(null, { status: 204 }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("logs in via /auth/session in web mode", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    const tokenField = container.querySelector<HTMLTextAreaElement>('[data-testid="login-token"]');
    expect(tokenField).not.toBeNull();

    act(() => {
      tokenField!.value = "  test-token  ";
    });

    const loginButton = container.querySelector<HTMLButtonElement>('[data-testid="login-button"]');
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ws.connect).toHaveBeenCalledTimes(1);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("rejects blank tokens on the login page", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    const loginButton = container.querySelector<HTMLButtonElement>('[data-testid="login-button"]');
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(container.textContent).toContain("Token is required");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
}

function registerLoginErrorTests(): void {
  it("surfaces gateway errors when login fails", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "unauthorized", message: "invalid token" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    const tokenField = container.querySelector<HTMLTextAreaElement>('[data-testid="login-token"]');
    expect(tokenField).not.toBeNull();

    act(() => {
      tokenField!.value = "test-token";
    });

    const loginButton = container.querySelector<HTMLButtonElement>('[data-testid="login-button"]');
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ws.connect).toHaveBeenCalledTimes(0);
    expect(container.textContent).toContain("invalid token");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("surfaces json error codes when login fails without a message field", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    const tokenField = container.querySelector<HTMLTextAreaElement>('[data-testid="login-token"]');
    expect(tokenField).not.toBeNull();

    act(() => {
      tokenField!.value = "test-token";
    });

    const loginButton = container.querySelector<HTMLButtonElement>('[data-testid="login-button"]');
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ws.connect).toHaveBeenCalledTimes(0);
    expect(container.textContent).toContain("unauthorized");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("surfaces text errors when login fails with non-json response", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("gateway exploded", {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    const tokenField = container.querySelector<HTMLTextAreaElement>('[data-testid="login-token"]');
    expect(tokenField).not.toBeNull();

    act(() => {
      tokenField!.value = "test-token";
    });

    const loginButton = container.querySelector<HTMLButtonElement>('[data-testid="login-button"]');
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ws.connect).toHaveBeenCalledTimes(0);
    expect(container.textContent).toContain("gateway exploded");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("surfaces disconnect details on the connect page", () => {
    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    act(() => {
      ws.emit("disconnected", { code: 4001, reason: "unauthorized" });
    });

    expect(container.textContent).toContain("Disconnected");
    expect(container.textContent).toContain("unauthorized");
    expect(container.textContent).toContain("4001");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("keeps the app shell visible while recovering from a transient disconnect", () => {
    vi.useFakeTimers();
    try {
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

      // Shell is visible while connected.
      expect(container.querySelector('[data-testid="nav-dashboard"]')).not.toBeNull();

      act(() => {
        ws.emit("disconnected", { code: 1006, reason: "net down" });
        ws.emit("reconnect_scheduled", {
          delayMs: 20_000,
          nextRetryAtMs: Date.now() + 20_000,
          attempt: 1,
        });
      });

      // Still visible while recovering (connecting).
      expect(container.querySelector('[data-testid="nav-dashboard"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="login-button"]')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(10_001);
      });

      // After grace expires, fall back to the connect screen but stay in a
      // visible reconnecting state if a retry is scheduled.
      expect(container.querySelector('[data-testid="login-button"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="nav-dashboard"]')).toBeNull();
      expect(container.querySelector('[data-testid="login-button"]')?.textContent).toContain(
        "Connecting",
      );
      expect(container.querySelector('[data-testid="cancel-connect-button"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="login-button"]')?.textContent).toMatch(
        /Connecting \(\d+s\)/,
      );

      act(() => {
        ws.emit("disconnected", { code: 1006, reason: "still down" });
      });

      // Once gated, repeated transient disconnect events should not re-show shell,
      // and should keep showing a reconnecting state on the connect page.
      expect(container.querySelector('[data-testid="login-button"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="nav-dashboard"]')).toBeNull();
      expect(container.querySelector('[data-testid="login-button"]')?.textContent).toContain(
        "Connecting",
      );
      expect(container.querySelector('[data-testid="cancel-connect-button"]')).not.toBeNull();

      act(() => {
        root?.unmount();
      });
      container.remove();
    } finally {
      vi.useRealTimers();
    }
  });
}

export function registerLoginTests(): void {
  registerLoginFormTests();
  registerLoginErrorTests();
}
