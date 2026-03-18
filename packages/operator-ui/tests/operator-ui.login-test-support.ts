import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import { createDeferred } from "./operator-ui.test-support.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

type WebAuthPersistence = {
  hasStoredToken: boolean;
  readToken?: () => Promise<string | null> | string | null;
  saveToken?: (token: string) => Promise<void> | void;
  clearToken?: () => Promise<void> | void;
};

function renderWebOperatorApp(params?: {
  authToken?: string;
  ws?: FakeWsClient;
  webAuthPersistence?: WebAuthPersistence;
}): {
  container: HTMLDivElement;
  root: Root;
  ws: FakeWsClient;
} {
  const ws = params?.ws ?? new FakeWsClient(false);
  const { http } = createFakeHttpClient();
  const core = createOperatorCore({
    wsUrl: "ws://example.test/ws",
    httpBaseUrl: "http://example.test",
    auth: createBearerTokenAuth(params?.authToken ?? ""),
    deps: { ws, http },
  });

  const webAuthPersistence = params?.webAuthPersistence
    ? {
        hasStoredToken: params.webAuthPersistence.hasStoredToken,
        readToken: params.webAuthPersistence.readToken ?? vi.fn(async () => null),
        saveToken: params.webAuthPersistence.saveToken ?? vi.fn(),
        clearToken: params.webAuthPersistence.clearToken ?? vi.fn(),
      }
    : undefined;

  const container = document.createElement("div");
  document.body.appendChild(container);

  let root: Root | null = null;
  act(() => {
    root = createRoot(container);
    root.render(
      React.createElement(OperatorUiApp, {
        core,
        mode: "web",
        webAuthPersistence,
      }),
    );
  });

  if (!root) {
    throw new Error("Failed to create React root.");
  }

  return { container, root, ws };
}

function cleanup(root: Root, container: HTMLDivElement): void {
  act(() => {
    root.unmount();
  });
  container.remove();
}

function getTokenField(container: HTMLElement): HTMLInputElement {
  const tokenField = container.querySelector<HTMLInputElement>('[data-testid="login-token"]');
  expect(tokenField).not.toBeNull();
  return tokenField!;
}

function getLoginButton(container: HTMLElement): HTMLButtonElement {
  const loginButton = container.querySelector<HTMLButtonElement>('[data-testid="login-button"]');
  expect(loginButton).not.toBeNull();
  return loginButton!;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) {
    throw new Error("Failed to resolve input value setter");
  }
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function registerLoginFormTests(): void {
  it("disables browser assistance on the login token field", () => {
    const { container, root } = renderWebOperatorApp();

    const tokenField = getTokenField(container);
    expect(tokenField.getAttribute("spellcheck")).toBe("false");
    expect(tokenField.getAttribute("autocapitalize")).toBe("none");
    expect(tokenField.getAttribute("autocorrect")).toBe("off");

    cleanup(root, container);
  });

  it("wraps the connect screen in a scroll area", () => {
    const { container, root } = renderWebOperatorApp();

    const scrollArea = container.querySelector<HTMLElement>("[data-scroll-area-root]");
    expect(scrollArea).not.toBeNull();
    expect(scrollArea?.className).toContain("h-full");
    expect(scrollArea?.className).toContain("w-full");
    expect(container.querySelector('[data-testid="login-button"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="login-token-help"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Need a gateway token?");
    expect(container.textContent).not.toContain("Saved token available");

    cleanup(root, container);
  });

  it("sets aria-busy on the login button while saving a token", async () => {
    const saveToken = vi.fn();
    const deferred = createDeferred<void>();
    saveToken.mockReturnValue(deferred.promise);
    const { container, root } = renderWebOperatorApp({
      webAuthPersistence: {
        hasStoredToken: false,
        saveToken,
      },
    });

    const tokenField = getTokenField(container);
    act(() => {
      setInputValue(tokenField, "test-token");
    });

    const loginButton = getLoginButton(container);
    await act(async () => {
      loginButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const liveButton = getLoginButton(container);
    expect(saveToken).toHaveBeenCalledWith("test-token");
    expect(liveButton.getAttribute("aria-busy")).toBe("true");

    deferred.resolve();
    await act(async () => {
      await Promise.resolve();
    });

    cleanup(root, container);
  });

  it("saves a trimmed browser token and waits for reload instead of connecting immediately", async () => {
    const saveToken = vi.fn(async () => {});
    const { container, root, ws } = renderWebOperatorApp({
      webAuthPersistence: {
        hasStoredToken: false,
        saveToken,
      },
    });

    const tokenField = getTokenField(container);
    act(() => {
      setInputValue(tokenField, "  test-token  ");
    });

    const loginButton = getLoginButton(container);
    await act(async () => {
      loginButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(saveToken).toHaveBeenCalledTimes(1);
    expect(saveToken).toHaveBeenCalledWith("test-token");
    expect(ws.connect).toHaveBeenCalledTimes(0);

    cleanup(root, container);
  });

  it("rejects blank tokens on the login page when nothing is saved", async () => {
    const { container, root, ws } = renderWebOperatorApp({
      webAuthPersistence: {
        hasStoredToken: false,
      },
    });

    const loginButton = getLoginButton(container);
    await act(async () => {
      loginButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(ws.connect).toHaveBeenCalledTimes(0);
    expect(container.textContent).toContain("Token is required");

    cleanup(root, container);
  });

  it("loads the saved token into the field and connects with it", async () => {
    const readToken = vi.fn(async () => "stored-token");
    const saveToken = vi.fn(async () => {});
    const { container, root, ws } = renderWebOperatorApp({
      webAuthPersistence: {
        hasStoredToken: true,
        readToken,
        saveToken,
      },
    });

    await flushEffects();

    const tokenField = getTokenField(container);
    expect(readToken).toHaveBeenCalledTimes(1);
    expect(tokenField.value).toBe("stored-token");
    expect(container.textContent).toContain("Forget saved token");

    const loginButton = getLoginButton(container);
    await act(async () => {
      loginButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(saveToken).not.toHaveBeenCalled();
    expect(ws.connect).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Token is required");

    cleanup(root, container);
  });

  it("replaces the saved token when a new token is entered", async () => {
    const saveToken = vi.fn(async () => {});
    const { container, root, ws } = renderWebOperatorApp({
      webAuthPersistence: {
        hasStoredToken: true,
        readToken: async () => "stored-token",
        saveToken,
      },
    });

    await flushEffects();

    const tokenField = getTokenField(container);
    act(() => {
      setInputValue(tokenField, "  replacement-token  ");
    });

    const loginButton = getLoginButton(container);
    await act(async () => {
      loginButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(saveToken).toHaveBeenCalledWith("replacement-token");
    expect(ws.connect).toHaveBeenCalledTimes(0);

    cleanup(root, container);
  });

  it("forgets the saved token from the connect page", async () => {
    const clearToken = vi.fn(async () => {});
    const { container, root } = renderWebOperatorApp({
      webAuthPersistence: {
        hasStoredToken: true,
        readToken: async () => "stored-token",
        clearToken,
      },
    });

    await flushEffects();

    const forgetButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="forget-saved-token-button"]',
    );
    expect(forgetButton).not.toBeNull();

    await act(async () => {
      forgetButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(clearToken).toHaveBeenCalledTimes(1);

    cleanup(root, container);
  });
}

function registerLoginErrorTests(): void {
  it("surfaces persistence errors when saving a token fails", async () => {
    const saveToken = vi.fn(async () => {
      throw new Error("storage exploded");
    });
    const { container, root, ws } = renderWebOperatorApp({
      webAuthPersistence: {
        hasStoredToken: false,
        saveToken,
      },
    });

    const tokenField = getTokenField(container);
    act(() => {
      setInputValue(tokenField, "test-token");
    });

    const loginButton = getLoginButton(container);
    await act(async () => {
      loginButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(ws.connect).toHaveBeenCalledTimes(0);
    expect(container.textContent).toContain("storage exploded");

    cleanup(root, container);
  });

  it("surfaces persistence errors when forgetting a saved token fails", async () => {
    const clearToken = vi.fn(async () => {
      throw new Error("clear exploded");
    });
    const { container, root } = renderWebOperatorApp({
      webAuthPersistence: {
        hasStoredToken: true,
        readToken: async () => "stored-token",
        clearToken,
      },
    });

    await flushEffects();

    const forgetButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="forget-saved-token-button"]',
    );
    expect(forgetButton).not.toBeNull();

    await act(async () => {
      forgetButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("clear exploded");

    cleanup(root, container);
  });

  it("surfaces disconnect details on the connect page", () => {
    const ws = new FakeWsClient(false);
    const { container, root } = renderWebOperatorApp({ ws });

    act(() => {
      ws.emit("disconnected", { code: 4001, reason: "unauthorized" });
    });

    expect(container.textContent).toContain("Disconnected");
    expect(container.textContent).toContain("unauthorized");
    expect(container.textContent).toContain("4001");

    cleanup(root, container);
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

      expect(container.querySelector('[data-testid="nav-dashboard"]')).not.toBeNull();

      act(() => {
        ws.emit("disconnected", { code: 1006, reason: "net down" });
        ws.emit("reconnect_scheduled", {
          delayMs: 20_000,
          nextRetryAtMs: Date.now() + 20_000,
          attempt: 1,
        });
      });

      expect(container.querySelector('[data-testid="nav-dashboard"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="login-button"]')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(10_001);
      });

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
