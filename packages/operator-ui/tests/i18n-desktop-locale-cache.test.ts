// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperatorUiHostProvider } from "../src/host/host-api.js";
import { LocaleProvider, useLocale } from "../src/i18n.js";

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

function setNavigatorLocales(languages: string[], language = languages[0] ?? "en-US"): void {
  Object.defineProperty(window.navigator, "languages", {
    configurable: true,
    value: languages,
  });
  Object.defineProperty(window.navigator, "language", {
    configurable: true,
    value: language,
  });
}

describe("desktop locale cache sync", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
    document.documentElement.lang = "";
  });

  it("keeps localStorage aligned with desktop locale config and updates", async () => {
    const { container, root } = createTestRoot();
    const store = stubLocalStorage();
    setNavigatorLocales(["en-US"]);
    localStorage.setItem("tyrum.localeSetting", "en");

    const setConfig = vi.fn(async () => ({}));
    const desktopApi = {
      getConfig: async () => ({ locale: { setting: "nl" } }),
      setConfig,
    };

    let api: ReturnType<typeof useLocale> | null = null;
    const Probe = () => {
      api = useLocale();
      return null;
    };

    await act(async () => {
      root.render(
        React.createElement(
          OperatorUiHostProvider,
          { value: { kind: "desktop", api: desktopApi } },
          React.createElement(LocaleProvider, null, React.createElement(Probe, null)),
        ),
      );
      await Promise.resolve();
    });

    expect(api?.setting).toBe("nl");
    expect(api?.locale).toBe("nl");
    expect(store.get("tyrum.localeSetting")).toBe("nl");

    await act(async () => {
      api?.setSetting("system");
      await Promise.resolve();
    });

    expect(setConfig).toHaveBeenCalledWith({ locale: { setting: "system" } });
    expect(store.get("tyrum.localeSetting")).toBe("system");

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
