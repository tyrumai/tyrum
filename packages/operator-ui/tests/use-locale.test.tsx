// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useIntl } from "react-intl";
import { OperatorUiHostProvider } from "../src/host/host-api.js";
import { LocaleProvider, useLocale, useLocaleOptional } from "../src/i18n.js";

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

describe("LocaleProvider/useLocale", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
    document.documentElement.lang = "";
  });

  it("defaults to the resolved system locale on web", () => {
    const { container, root } = createTestRoot();
    stubLocalStorage();
    setNavigatorLocales(["nl-NL", "en-US"]);

    let locale: string | null = null;
    const Probe = () => {
      locale = useLocale().locale;
      return null;
    };

    act(() => {
      root.render(React.createElement(LocaleProvider, null, React.createElement(Probe, null)));
    });

    expect(locale).toBe("nl");
    expect(document.documentElement.lang).toBe("nl");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("falls back to English when the system locale is unsupported", () => {
    const { container, root } = createTestRoot();
    stubLocalStorage();
    setNavigatorLocales(["fr-FR"], "fr-FR");

    let locale: string | null = null;
    let languageLabel = "";
    const Probe = () => {
      locale = useLocale().locale;
      languageLabel = useIntl().formatMessage({ id: "Language", defaultMessage: "Language" });
      return null;
    };

    act(() => {
      root.render(React.createElement(LocaleProvider, null, React.createElement(Probe, null)));
    });

    expect(locale).toBe("en");
    expect(languageLabel).toBe("Language");
    expect(document.documentElement.lang).toBe("en");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("reads and persists localStorage locale setting", () => {
    const { container, root } = createTestRoot();
    const store = stubLocalStorage();
    setNavigatorLocales(["en-US"]);
    localStorage.setItem("tyrum.localeSetting", "nl");

    let api: ReturnType<typeof useLocale> | null = null;
    const Probe = () => {
      api = useLocale();
      return null;
    };

    act(() => {
      root.render(React.createElement(LocaleProvider, null, React.createElement(Probe, null)));
    });

    expect(api?.setting).toBe("nl");
    expect(api?.locale).toBe("nl");
    expect(document.documentElement.lang).toBe("nl");

    act(() => {
      api?.setSetting("en");
    });

    expect(localStorage.getItem("tyrum.localeSetting")).toBe("en");
    expect(store.get("tyrum.localeSetting")).toBe("en");
    expect(document.documentElement.lang).toBe("en");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("uses desktop config when Desktop API exists", async () => {
    const { container, root } = createTestRoot();
    stubLocalStorage();
    setNavigatorLocales(["en-US"]);

    const setConfig = vi.fn(async () => ({}));
    const desktopApi = {
      getConfig: async () => ({ locale: { setting: "nl" } }),
      setConfig,
    };

    let api: ReturnType<typeof useLocale> | null = null;
    let systemOptionLabel = "";
    let greeting = "";
    const Probe = () => {
      api = useLocale();
      greeting = useIntl().formatMessage({ id: "Language", defaultMessage: "Language" });
      systemOptionLabel = api.languageOptions[0]?.label ?? "";
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
    expect(document.documentElement.lang).toBe("nl");
    expect(greeting).toBe("Taal");
    expect(systemOptionLabel).toContain("Systeemstandaard");

    await act(async () => {
      api?.setSetting("system");
      await Promise.resolve();
    });

    expect(setConfig).toHaveBeenCalledWith({ locale: { setting: "system" } });

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("returns null from useLocaleOptional when LocaleProvider is missing", () => {
    const { container, root } = createTestRoot();

    let value: ReturnType<typeof useLocaleOptional> | null = null;
    const Probe = () => {
      value = useLocaleOptional();
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
