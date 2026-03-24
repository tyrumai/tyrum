// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { OperatorUiHostProvider } from "../src/host/host-api.js";
import { ThemeProvider, useTheme, useThemeOptional } from "../src/hooks/use-theme.js";

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
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
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
      root.render(React.createElement(ThemeProvider, null, React.createElement(Probe, null)));
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
      root.render(React.createElement(ThemeProvider, null, React.createElement(Probe, null)));
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

  it("marks theme preferences as stored after the user chooses them", () => {
    const { container, root } = createTestRoot();
    stubLocalStorage();

    let api: ReturnType<typeof useTheme> | null = null;
    const Probe = () => {
      api = useTheme();
      return null;
    };

    act(() => {
      root.render(React.createElement(ThemeProvider, null, React.createElement(Probe, null)));
    });

    expect(api?.hasStoredModePreference).toBe(false);
    expect(api?.hasStoredPalettePreference).toBe(false);

    act(() => {
      api?.setMode("light");
      api?.setPalette("sage");
    });

    expect(api?.hasStoredModePreference).toBe(true);
    expect(api?.hasStoredPalettePreference).toBe(true);
    expect(localStorage.getItem("tyrum.themeMode")).toBe("light");
    expect(localStorage.getItem("tyrum.colorPalette")).toBe("sage");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("does not re-read localStorage on rerender", () => {
    const { container, root } = createTestRoot();
    stubLocalStorage();
    const getItemSpy = vi.spyOn(localStorage, "getItem");

    let api: ReturnType<typeof useTheme> | null = null;
    const Probe = () => {
      api = useTheme();
      return null;
    };

    act(() => {
      root.render(React.createElement(ThemeProvider, null, React.createElement(Probe, null)));
    });

    expect(getItemSpy).toHaveBeenCalledTimes(2);

    act(() => {
      api?.setMode("light");
      api?.setPalette("sage");
    });

    expect(getItemSpy).toHaveBeenCalledTimes(2);

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

  it("refreshes system theme when switching into system mode", async () => {
    const { container, root } = createTestRoot();
    stubLocalStorage();

    let matches = true;
    (window as unknown as { matchMedia?: unknown }).matchMedia = vi.fn((query: string) => {
      expect(query).toBe("(prefers-color-scheme: dark)");
      return {
        get matches() {
          return matches;
        },
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
    });

    localStorage.setItem("tyrum.themeMode", "dark");

    let api: ReturnType<typeof useTheme> | null = null;
    const Probe = () => {
      api = useTheme();
      return null;
    };

    act(() => {
      root.render(React.createElement(ThemeProvider, null, React.createElement(Probe, null)));
    });

    expect(document.documentElement.dataset.theme).toBe("dark");

    // Simulate OS switching to light while we're not in system mode.
    matches = false;

    await act(async () => {
      api?.setMode("system");
      await Promise.resolve();
    });

    expect(api?.mode).toBe("system");
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
    const desktopApi = {
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
    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = desktopApi;

    let api: ReturnType<typeof useTheme> | null = null;
    const Probe = () => {
      api = useTheme();
      return null;
    };

    await act(async () => {
      root.render(
        React.createElement(
          OperatorUiHostProvider,
          { value: { kind: "desktop", api: desktopApi } },
          React.createElement(ThemeProvider, null, React.createElement(Probe, null)),
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

  it("returns null from useThemeOptional when ThemeProvider is missing", () => {
    const { container, root } = createTestRoot();

    let value: ReturnType<typeof useThemeOptional> | null = null;
    const Probe = () => {
      value = useThemeOptional();
      return null;
    };

    act(() => {
      root.render(React.createElement(Probe, null));
    });

    expect(value).toBeNull();

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});

describe("ThemeProvider palette", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
    delete document.documentElement.dataset.palette;
  });

  it("defaults to copper palette with no data-palette attribute", () => {
    const { container, root } = createTestRoot();
    stubLocalStorage();

    let palette: string | null = null;
    const Probe = () => {
      palette = useTheme().palette;
      return null;
    };

    act(() => {
      root.render(React.createElement(ThemeProvider, null, React.createElement(Probe, null)));
    });

    expect(palette).toBe("copper");
    expect(document.documentElement.dataset.palette).toBeUndefined();

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("reads and persists localStorage palette", () => {
    const { container, root } = createTestRoot();
    const store = stubLocalStorage();
    localStorage.setItem("tyrum.colorPalette", "ocean");

    let api: ReturnType<typeof useTheme> | null = null;
    const Probe = () => {
      api = useTheme();
      return null;
    };

    act(() => {
      root.render(React.createElement(ThemeProvider, null, React.createElement(Probe, null)));
    });

    expect(api?.palette).toBe("ocean");
    expect(document.documentElement.dataset.palette).toBe("ocean");

    act(() => {
      api?.setPalette("sage");
    });

    expect(store.get("tyrum.colorPalette")).toBe("sage");
    expect(document.documentElement.dataset.palette).toBe("sage");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("removes data-palette attribute when switching to copper", () => {
    const { container, root } = createTestRoot();
    stubLocalStorage();
    localStorage.setItem("tyrum.colorPalette", "neon");

    let api: ReturnType<typeof useTheme> | null = null;
    const Probe = () => {
      api = useTheme();
      return null;
    };

    act(() => {
      root.render(React.createElement(ThemeProvider, null, React.createElement(Probe, null)));
    });

    expect(document.documentElement.dataset.palette).toBe("neon");

    act(() => {
      api?.setPalette("copper");
    });

    expect(document.documentElement.dataset.palette).toBeUndefined();

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("uses desktop config colorPalette when Desktop API exists", async () => {
    const { container, root } = createTestRoot();
    stubLocalStorage();

    const setConfig = vi.fn(async () => ({}));
    const desktopApi = {
      getConfig: async () => ({ theme: { source: "dark", colorPalette: "sage" } }),
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
    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = desktopApi;

    let api: ReturnType<typeof useTheme> | null = null;
    const Probe = () => {
      api = useTheme();
      return null;
    };

    await act(async () => {
      root.render(
        React.createElement(
          OperatorUiHostProvider,
          { value: { kind: "desktop", api: desktopApi } },
          React.createElement(ThemeProvider, null, React.createElement(Probe, null)),
        ),
      );
      await Promise.resolve();
    });

    expect(api?.palette).toBe("sage");
    expect(document.documentElement.dataset.palette).toBe("sage");

    await act(async () => {
      api?.setPalette("neon");
      await Promise.resolve();
    });

    expect(setConfig).toHaveBeenCalledWith({ theme: { colorPalette: "neon" } });

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
