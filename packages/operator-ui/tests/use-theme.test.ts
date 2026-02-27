// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, useTheme } from "../src/hooks/use-theme.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createTestRoot() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

function stubLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
  return store;
}

describe("ThemeProvider/useTheme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  it("defaults to dark theme on web", () => {
    const { container, root } = createTestRoot();
    stubLocalStorage();
    localStorage.removeItem("tyrum.themeMode");

    let mode: string | null = null;
    const Probe = () => {
      mode = useTheme().mode;
      return null;
    };

    act(() => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(Probe, null),
        ),
      );
    });

    expect(mode).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("reads and persists localStorage theme mode", () => {
    const { container, root } = createTestRoot();
    const store = stubLocalStorage();
    localStorage.setItem("tyrum.themeMode", "light");

    let api: ReturnType<typeof useTheme> | null = null;
    const Probe = () => {
      api = useTheme();
      return null;
    };

    act(() => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(Probe, null),
        ),
      );
    });

    expect(api?.mode).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => {
      api?.setMode("dark");
    });

    expect(localStorage.getItem("tyrum.themeMode")).toBe("dark");
    expect(store.get("tyrum.themeMode")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("resolves system mode from prefers-color-scheme", () => {
    const { container, root } = createTestRoot();
    stubLocalStorage();

    (window as unknown as { matchMedia?: unknown }).matchMedia = vi.fn((query: string) => {
      expect(query).toBe("(prefers-color-scheme: dark)");
      return {
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
    });

    localStorage.setItem("tyrum.themeMode", "system");

    act(() => {
      root.render(React.createElement(ThemeProvider, null, null));
    });

    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("uses desktop config when Desktop API exists", async () => {
    const { container, root } = createTestRoot();
    stubLocalStorage();
    localStorage.setItem("tyrum.themeMode", "light");

    const setConfig = vi.fn(async () => ({}));
    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = {
      getConfig: async () => ({ theme: { source: "dark" } }),
      setConfig,
      gateway: {
        getStatus: async () => ({ status: "ok", port: 0 }),
        start: async () => ({ status: "ok", port: 0 }),
        stop: async () => ({ status: "ok" }),
      },
      node: {
        connect: async () => ({ status: "ok" }),
        disconnect: async () => ({ status: "ok" }),
      },
      onStatusChange: () => () => {},
    };

    let api: ReturnType<typeof useTheme> | null = null;
    const Probe = () => {
      api = useTheme();
      return null;
    };

    await act(async () => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(Probe, null),
        ),
      );
      await Promise.resolve();
    });

    expect(api?.mode).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    await act(async () => {
      api?.setMode("light");
      await Promise.resolve();
    });

    expect(setConfig).toHaveBeenCalledWith({ theme: { source: "light" } });

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
