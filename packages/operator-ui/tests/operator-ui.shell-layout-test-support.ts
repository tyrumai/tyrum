import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import * as operatorUi from "../src/index.js";
import { stubMatchMedia } from "./test-utils.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

function registerShellLayoutRenderTests(): void {
  it("does not export internal mode banners from the public API", () => {
    expect("AdminModeBanner" in operatorUi).toBe(false);
    expect("ElevatedModeBanner" in operatorUi).toBe(false);
  });

  it("applies the stored theme mode when mounting OperatorUiApp", () => {
    const localStorageMock = {
      getItem: vi.fn((key: string) => (key === "tyrum.themeMode" ? "light" : null)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", localStorageMock as unknown as Storage);

    const ws = new FakeWsClient(false);
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

    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("does not inject the legacy operator-ui css", () => {
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

    const styles = Array.from(container.querySelectorAll("style"));
    expect(styles.some((style) => style.textContent?.includes(".tyrum-operator-ui"))).toBe(false);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("does not render legacy layout class names", async () => {
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

    expect(container.querySelector(".card")).toBeNull();
    expect(container.querySelector(".stack")).toBeNull();
    expect(container.querySelector(".alert")).toBeNull();

    const desktopLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-desktop"]');
    expect(desktopLink).not.toBeNull();

    await act(async () => {
      desktopLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector(".card")).toBeNull();
    expect(container.querySelector(".stack")).toBeNull();
    expect(container.querySelector(".alert")).toBeNull();

    const configureLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-configure"]',
    );
    expect(configureLink).not.toBeNull();

    act(() => {
      configureLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector(".card")).toBeNull();
    expect(container.querySelector(".stack")).toBeNull();
    expect(container.querySelector(".alert")).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("renders the operator shell navigation", () => {
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

    expect(container.textContent).toContain("Dashboard");
    expect(container.querySelector('[data-testid="sidebar-collapse-toggle"]')).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("gates navigation and non-connect routes while disconnected", () => {
    const ws = new FakeWsClient(false);
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

    expect(container.querySelector('[data-testid="login-button"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="nav-dashboard"]')).toBeNull();
    expect(container.querySelector('[data-testid="nav-configure"]')).toBeNull();
    expect(container.textContent).not.toContain("Connection status:");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
}

function registerShellLayoutNavTests(): void {
  it("renders a bottom tab bar on web below md breakpoint", () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const matchMedia = stubMatchMedia("(min-width: 768px)", false);

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector("[data-testid='nav-more']")).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
    matchMedia.cleanup();
  });

  it("switches pages from the sidebar", () => {
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

    expect(container.textContent).toContain("Connect");

    const approvalsLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-approvals"]',
    );
    expect(approvalsLink).not.toBeNull();

    act(() => {
      approvalsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Approvals");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
}

export function registerShellLayoutTests(): void {
  registerShellLayoutRenderTests();
  registerShellLayoutNavTests();
}
